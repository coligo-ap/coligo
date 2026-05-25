package com.coligo.app.sunmi;

import android.os.RemoteException;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Plugin Capacitor « SunmiPrinter » — pont JS ↔ {@link SunmiService}.
 *
 * Exposé côté JS via {@code Capacitor.Plugins.SunmiPrinter}. API minimale,
 * orientée commandes typées :
 *
 *  - {@code isAvailable()} : { available: boolean, model?: string }
 *  - {@code print({ commands, copies?, init?, cut? })} : exécute la liste de
 *    commandes en mode buffer (atomique — soit tout passe, soit rien). Les
 *    commandes sont des objets {@code { type: string, ... }} décrits dans
 *    {@code lib/native/sunmi-printer.ts}.
 */
@CapacitorPlugin(name = "SunmiPrinter")
public class SunmiPrinterPlugin extends Plugin {
  private static final String TAG = "SunmiPrinterPlugin";

  private SunmiService sunmi;

  @Override
  public void load() {
    super.load();
    sunmi = new SunmiService(getContext());
    // Bind éager : sur Sunmi, le service est local et le bind est quasi
    // instantané ; sur autres appareils, on essuie l'échec une fois et on
    // retient « non disponible ».
    sunmi.tryBind();
  }

  @PluginMethod
  public void isAvailable(PluginCall call) {
    JSObject res = new JSObject();
    boolean ready = sunmi != null && sunmi.isReady();
    if (!ready && sunmi != null) {
      // Deuxième chance si on est appelé avant que onServiceConnected ait
      // résolu — sur certains modèles le bind asynchrone prend ~50 ms.
      sunmi.tryBind();
      ready = sunmi.isReady();
    }
    res.put("available", ready);
    if (sunmi != null && sunmi.getLastError() != null) {
      res.put("error", sunmi.getLastError());
    }
    call.resolve(res);
  }

  @PluginMethod
  public void print(PluginCall call) {
    if (sunmi == null || !sunmi.isReady()) {
      call.reject("Sunmi printer service not available");
      return;
    }

    JSArray commands = call.getArray("commands");
    if (commands == null) {
      call.reject("'commands' array is required");
      return;
    }

    int copies = call.getInt("copies", 1);
    copies = Math.max(1, Math.min(5, copies));
    boolean autoInit = call.getBoolean("init", Boolean.TRUE);
    boolean autoCut = call.getBoolean("cut", Boolean.TRUE);

    try {
      for (int copy = 0; copy < copies; copy++) {
        // IMPORTANT — Mode DIRECT (pas de enterPrinterBuffer / exitPrinterBuffer).
        //
        // Observation Sunmi V3 (firmware mai 2026) : en mode buffer, le firmware
        // n'imprime que printColumnsText et printQRCode. Tous les printText
        // (et setAlignment qui les précède) sont silencieusement avalés ;
        // résultat : bandeau, #ID, code de retrait, footer disparaissent du
        // papier alors que le QR et les colonnes du récap sortent.
        //
        // En direct, chaque commande est flush immédiatement vers l'imprimante
        // thermique. Coût : ~30 ms par commande (négligeable, < 1 s pour un
        // ticket complet). On perd l'atomicité (un crash en milieu de séquence
        // laisserait un demi-ticket) mais c'est un trade-off acceptable pour
        // que le ticket soit complet — fait sortir le bandeau RETRAIT, le
        // #ID énorme, le code, tout.
        if (autoInit) sunmi.printerInit();

        int n = commands.length();
        for (int i = 0; i < n; i++) {
          JSONObject cmd = commands.getJSONObject(i);
          executeCommand(cmd);
        }

        // Marge avant la coupe pour ne pas tronquer le QR.
        sunmi.lineWrap(3);
        if (autoCut) sunmi.cutPaper();
      }
      JSObject res = new JSObject();
      res.put("printed", copies);
      call.resolve(res);
    } catch (RemoteException e) {
      Log.e(TAG, "Sunmi print failed (RemoteException)", e);
      call.reject("Sunmi printer service error: " + e.getMessage());
    } catch (JSONException e) {
      Log.e(TAG, "Sunmi print failed (bad command)", e);
      call.reject("Invalid command payload: " + e.getMessage());
    }
  }

  private void executeCommand(JSONObject cmd) throws RemoteException, JSONException {
    String type = cmd.optString("type", "");
    // Trace TOUTE commande exécutée — corrélation immédiate avec un éventuel
    // « Sunmi raise -X » émis juste après par le callback du service AIDL :
    //   I/SunmiPrinterPlugin: exec size {"type":"size","value":56.0}
    //   W/SunmiService: Sunmi raise -5: Illegal parameter
    // → on sait que c'est `size 56` qui plante.
    Log.i(TAG, "exec " + type + " " + cmd.toString());
    switch (type) {
      case "align": {
        // Sunmi : 0 = left, 1 = center, 2 = right.
        String v = cmd.optString("value", "left");
        int align = "center".equals(v) ? 1 : "right".equals(v) ? 2 : 0;
        sunmi.setAlignment(align);
        return;
      }
      case "size": {
        // Sunmi clampe l'API mais émet « Illegal parameter » au-delà d'un
        // certain seuil selon le modèle (V3 firmware récent → 56 max
        // observé). On clamp défensivement côté plugin pour éviter de
        // casser une séquence d'impression (firmware reste perturbé
        // jusqu'au prochain printerInit).
        double raw = cmd.optDouble("value", 24.0);
        float size = (float) Math.max(12.0, Math.min(56.0, raw));
        sunmi.setFontSize(size);
        return;
      }
      case "bold": {
        // ESC E n — n=1 bold on, n=0 off.
        boolean on = cmd.optBoolean("value", false);
        sunmi.sendRawBytes(new byte[] {0x1B, 0x45, (byte) (on ? 1 : 0)});
        return;
      }
      case "invert": {
        // GS B n — n=1 white-on-black, n=0 off.
        boolean on = cmd.optBoolean("value", false);
        sunmi.sendRawBytes(new byte[] {0x1D, 0x42, (byte) (on ? 1 : 0)});
        return;
      }
      case "text": {
        String text = cmd.optString("text", "");
        boolean newline = cmd.optBoolean("newline", true);
        sunmi.printText(newline ? text + "\n" : text);
        return;
      }
      case "textBold": {
        String text = cmd.optString("text", "");
        boolean newline = cmd.optBoolean("newline", true);
        sunmi.sendRawBytes(new byte[] {0x1B, 0x45, 1});
        sunmi.printText(newline ? text + "\n" : text);
        sunmi.sendRawBytes(new byte[] {0x1B, 0x45, 0});
        return;
      }
      case "textInverse": {
        String text = cmd.optString("text", "");
        boolean newline = cmd.optBoolean("newline", true);
        sunmi.sendRawBytes(new byte[] {0x1D, 0x42, 1});
        sunmi.printText(newline ? text + "\n" : text);
        sunmi.sendRawBytes(new byte[] {0x1D, 0x42, 0});
        return;
      }
      case "columns": {
        JSONObject obj = cmd;
        org.json.JSONArray colsArr = obj.getJSONArray("cols");
        org.json.JSONArray widthsArr = obj.getJSONArray("widths");
        org.json.JSONArray alignsArr = obj.optJSONArray("aligns");
        int nc = colsArr.length();
        String[] cols = new String[nc];
        int[] widths = new int[nc];
        int[] aligns = new int[nc];
        for (int i = 0; i < nc; i++) {
          cols[i] = colsArr.optString(i, "");
          widths[i] = widthsArr.optInt(i, 1);
          if (alignsArr != null && i < alignsArr.length()) {
            String a = alignsArr.optString(i, "left");
            aligns[i] = "center".equals(a) ? 1 : "right".equals(a) ? 2 : 0;
          }
        }
        sunmi.printColumnsText(cols, widths, aligns);
        return;
      }
      case "qr": {
        String data = cmd.optString("data", "");
        int moduleSize = cmd.optInt("moduleSize", 6);
        int errorLevel = cmd.optInt("errorLevel", 3); // 0=L, 1=M, 2=Q, 3=H
        sunmi.printQRCode(data, moduleSize, errorLevel);
        return;
      }
      case "wrap": {
        sunmi.lineWrap(cmd.optInt("n", 1));
        return;
      }
      case "cut": {
        sunmi.cutPaper();
        return;
      }
      case "init": {
        sunmi.printerInit();
        return;
      }
      default:
        Log.w(TAG, "Unknown Sunmi command type: " + type);
    }
  }
}
