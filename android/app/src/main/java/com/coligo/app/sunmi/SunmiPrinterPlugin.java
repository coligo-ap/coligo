package com.coligo.app.sunmi;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.RemoteException;
import android.util.Base64;
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

  /**
   * Suivi de l'état d'impression courant côté plugin. Le firmware Sunmi V3
   * ignore silencieusement `printText(...)` et `setAlignment(...)` —
   * on doit donc émuler ces commandes via `printColumnsText(...)`, qui est
   * la seule API texte fiable sur ce firmware.
   *
   * Stratégie :
   *  - `text/textBold/textInverse` → `printColumnsText([text],
   *    [paperColumns], [currentAlign])` — 1 colonne pleine largeur avec
   *    l'alignement intégré.
   *  - `align <value>` → MAJ `currentAlign` (et tente quand même
   *    setAlignment côté firmware au cas où la commande qui suit en
   *    bénéficierait, ex. printQRCode).
   *  - `size <value>` → MAJ `currentFontSize` snappée (utilisé pour
   *    printTextWithFont si besoin futur).
   *  - `paper <columns>` → permet de switcher 58 ↔ 80 mm depuis le JS.
   */
  private float currentFontSize = 24f;
  private int currentAlign = 0; // 0=left, 1=center, 2=right
  // 32 cols par défaut (Sunmi V3 = rouleau 50 mm → 384 dots / 12 dots-char).
  // Le builder JS envoie toujours `{ type:"paper", columns: N }` en tête de
  // séquence (32 pour 50/58 mm, 48 pour une 80 mm comptoir) — ce défaut n'est
  // qu'un filet de sécurité si la commande paper manquait.
  private int paperColumns = 32;

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

  /**
   * Imprime un bitmap PNG (base64) — chemin « capture HTML → image ».
   *
   * Pipeline : html2canvas côté JS → PNG redimensionné à 576px → base64.
   * On décode ici, on envoie via le service AIDL. Le firmware Sunmi V3
   * supporte natif printBitmap autour de enterPrinterBuffer / exitPrinterBuffer
   * pour atomicité.
   *
   * Params attendus depuis JS :
   *   - bitmap (string, requis) : base64 PNG SANS le préfixe data:image/png;base64,
   *   - copies (number, défaut 1) : nombre d'exemplaires
   *   - buffer (boolean, défaut true) : utilise enter/exit Buffer (atomique)
   *   - cut    (boolean, défaut true) : coupe le papier après chaque copie
   *   - feedLines (number, défaut 3) : line wraps avant la coupe
   */
  @PluginMethod
  public void printBitmap(PluginCall call) {
    if (sunmi == null || !sunmi.isReady()) {
      call.reject("Sunmi printer service not available");
      return;
    }
    String b64 = call.getString("bitmap");
    if (b64 == null || b64.isEmpty()) {
      call.reject("'bitmap' (base64 PNG) is required");
      return;
    }
    // Tolère un caller qui aurait oublié de strip le préfixe data:.
    int comma = b64.indexOf(',');
    if (b64.startsWith("data:") && comma > 0) {
      b64 = b64.substring(comma + 1);
    }

    int copies = Math.max(1, Math.min(5, call.getInt("copies", 1)));
    boolean useBuffer = call.getBoolean("buffer", Boolean.TRUE);
    boolean autoCut = call.getBoolean("cut", Boolean.TRUE);
    int feedLines = Math.max(0, Math.min(10, call.getInt("feedLines", 3)));

    byte[] bytes;
    try {
      bytes = Base64.decode(b64, Base64.DEFAULT);
    } catch (IllegalArgumentException e) {
      call.reject("Invalid base64 payload: " + e.getMessage());
      return;
    }
    Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    if (bitmap == null) {
      call.reject("Failed to decode PNG bitmap");
      return;
    }
    Log.i(TAG, "printBitmap " + bitmap.getWidth() + "x" + bitmap.getHeight()
        + " copies=" + copies + " buffer=" + useBuffer);

    try {
      for (int c = 0; c < copies; c++) {
        sunmi.printerInit();
        if (useBuffer) sunmi.enterBuffer(true);
        sunmi.printBitmap(bitmap);
        if (feedLines > 0) sunmi.lineWrap(feedLines);
        if (autoCut) sunmi.cutPaper();
        if (useBuffer) sunmi.exitBuffer(true);
      }
      JSObject res = new JSObject();
      res.put("printed", copies);
      call.resolve(res);
    } catch (RemoteException e) {
      Log.e(TAG, "Sunmi printBitmap failed", e);
      call.reject("Sunmi printer error: " + e.getMessage());
    } finally {
      bitmap.recycle();
    }
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
        // Compacte l'interligne au MINIMUM absolu (0 dots additionnels).
        // ESC 3 0 = pas d'espace en plus entre 2 line feeds. Combiné avec
        // ESC 2 (sélection du line spacing default réduit) sur certains
        // modèles. Si malgré ça ESC 3 est ignoré, on envoie aussi GS P
        // (set print position) ou similaire.
        sunmi.sendRawBytes(new byte[] {0x1B, 0x33, 0});

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

  /**
   * Imprime une ligne via printColumnsText (la seule API texte fiable sur
   * Sunmi V3). Largeur pleine = paperColumns, alignement = currentAlign.
   * Caractère vide → ligne blanche (équivalent d'un wrap simple).
   */
  /**
   * Active le « mode noir » maximal pour le texte qui suit :
   *   - ESC E 1 → emphase (double-frappe horizontale)
   *   - ESC G 1 → double-strike (double-frappe verticale)
   *
   * Combinés, c'est le rendu le plus dense que la tête thermique sait
   * produire SANS toucher à la largeur des caractères — la grille de
   * colonnes (48 en 80 mm) reste donc intacte, zéro coupure à droite.
   *
   * Indispensable : sur ce firmware, printColumnsText SANS emphase sort en
   * gris « fantôme » illisible, alors que le print test natif imprime du
   * texte normal bien noir. On force donc le gras sur TOUT le texte (le
   * papier thermique ne rend pas les polices fines) → lisible comme les
   * titres.
   */
  private void emphasisOn() throws RemoteException {
    sunmi.sendRawBytes(new byte[] {0x1B, 0x45, 1}); // ESC E 1  (emphasized)
    sunmi.sendRawBytes(new byte[] {0x1B, 0x47, 1}); // ESC G 1  (double-strike)
  }

  private void emphasisOff() throws RemoteException {
    sunmi.sendRawBytes(new byte[] {0x1B, 0x47, 0}); // ESC G 0
    sunmi.sendRawBytes(new byte[] {0x1B, 0x45, 0}); // ESC E 0
  }

  private void printLine(String text) throws RemoteException {
    if (text == null) text = "";
    emphasisOn();
    sunmi.printColumnsText(
        new String[] {text},
        new int[] {paperColumns},
        new int[] {currentAlign});
    emphasisOff();
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
        // `setAlignment` est ignoré par le firmware V3 pour printText ET
        // printQRCode (testé en prod). On mémorise localement pour les
        // emulations text→columns ET on envoie aussi ESC a n (commande
        // ESC/POS standard) au cas où le firmware respecte celle-ci pour
        // printQRCode / printBitmap.
        String v = cmd.optString("value", "left");
        int align = "center".equals(v) ? 1 : "right".equals(v) ? 2 : 0;
        currentAlign = align;
        sunmi.setAlignment(align);
        sunmi.sendRawBytes(new byte[] {0x1B, 0x61, (byte) align}); // ESC a n
        return;
      }
      case "paper": {
        // Permet au JS de switcher 58 mm (32 cols) ↔ 80 mm (48 cols).
        paperColumns = cmd.optInt("columns", 48);
        return;
      }
      case "lineSpacing": {
        // Définit l'interligne en dots (1 dot ≈ 0.125 mm). Plage utile :
        // 0..30. ESC 3 n côté ESC/POS standard, plus setLineSpacing AIDL
        // si disponible — on envoie les deux pour maximiser la chance.
        int dots = Math.max(0, Math.min(60, cmd.optInt("dots", 0)));
        sunmi.sendRawBytes(new byte[] {0x1B, 0x33, (byte) dots});
        return;
      }
      case "size": {
        // NE PAS appeler setFontSize ici.
        //
        // Le ticket est mis en page sur une grille de `paperColumns` colonnes
        // (48 en 80 mm) qui correspond EXACTEMENT à la police PAR DÉFAUT du
        // firmware — la même que le « print test » Sunmi natif (plein papier,
        // net, zéro coupure). Or `printColumnsText` interprète `colsWidthArr`
        // en colonnes-caractères RELATIVES à la police courante (setFontSize).
        // Donc dès qu'on changeait la police via setFontSize, une ligne de
        // 48 colonnes ne tenait plus sur 80 mm :
        //   - le bord droit était tronqué (nom boutique, prix coupés) ;
        //   - des lignes d'articles disparaissaient ou sortaient mal cadrées ;
        //   - les petites tailles imprimaient en glyphes fins → « pâle ».
        //
        // On reste donc sur la police par défaut (réinitialisée par
        // printerInit en tête de séquence). L'emphase « gros » passe
        // uniquement par le double-frappe (ESC ! / textBoldStrong), qui
        // s'applique PAR-DESSUS la police par défaut et halve déjà son budget
        // de colonnes — sans jamais casser la grille 48 colonnes.
        //
        // On garde juste la trace de la taille demandée (debug / futur
        // printTextWithFont) sans la pousser au firmware.
        double raw = cmd.optDouble("value", 24.0);
        currentFontSize = sunmi.snapFontSize((float) Math.max(12.0, Math.min(56.0, raw)));
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
        // EMULATION via printColumnsText : sur Sunmi V3, printText et
        // printTextWithFont sont ignorés silencieusement par le firmware.
        // Seul printColumnsText sort réellement sur papier — on émule
        // l'impression d'une ligne de texte par une colonne pleine largeur
        // avec l'alignement courant intégré.
        String text = cmd.optString("text", "");
        printLine(text);
        return;
      }
      case "textBold": {
        // Tout le texte est déjà en mode noir max (emphase + double-strike)
        // via printLine — textBold est donc identique à text sur ce firmware.
        // On garde le type distinct pour la sémantique côté builder.
        String text = cmd.optString("text", "");
        printLine(text);
        return;
      }
      case "textBoldStrong": {
        // Bold + double-width via ESC ! n. n=0x38 = emphasized + double
        // height + double width. Visuellement très imposant. On ajoute aussi
        // ESC G (double-strike) pour le rendu le plus dense possible.
        //
        // ATTENTION débordement : ESC ! 0x38 fait que chaque char rendu
        // occupe 2 dots-chars. Si on passe paperColumns à printColumnsText,
        // il pad le texte sur paperColumns chars, qui sortent en
        // 2×paperColumns dots → déborde de la largeur physique. On utilise
        // paperColumns/2 pour que le rendu visuel tienne sur le papier.
        String text = cmd.optString("text", "");
        int doubleW = Math.max(1, paperColumns / 2);
        sunmi.sendRawBytes(new byte[] {0x1B, 0x21, 0x38}); // ESC ! double+emph
        sunmi.sendRawBytes(new byte[] {0x1B, 0x47, 1}); // ESC G double-strike
        sunmi.printColumnsText(
            new String[] {text},
            new int[] {doubleW},
            new int[] {currentAlign});
        sunmi.sendRawBytes(new byte[] {0x1B, 0x47, 0}); // ESC G off
        sunmi.sendRawBytes(new byte[] {0x1B, 0x21, 0x00}); // ESC ! reset
        return;
      }
      case "textInverse": {
        // Vidéo inverse via GS B 1/0.
        String text = cmd.optString("text", "");
        sunmi.sendRawBytes(new byte[] {0x1D, 0x42, 1});
        printLine(text);
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
        // Mode noir max (emphase + double-strike) AVANT le rendu colonnes :
        // sinon les lignes d'articles (qty × nom .... prix) et la méta
        // sortaient en gris fantôme. Avec l'emphase elles sont noires et
        // nettes comme les titres, sans élargir les caractères → alignement
        // des colonnes préservé.
        emphasisOn();
        sunmi.printColumnsText(cols, widths, aligns);
        emphasisOff();
        return;
      }
      case "qr": {
        String data = cmd.optString("data", "");
        int moduleSize = cmd.optInt("moduleSize", 6);
        int errorLevel = cmd.optInt("errorLevel", 3); // 0=L, 1=M, 2=Q, 3=H
        // Force le centrage via ESC a 1 juste avant printQRCode (le firmware
        // V3 semble respecter ESC a pour le QR, contrairement à setAlignment
        // AIDL). On laisse `align` à sa valeur d'origine après pour les
        // commandes suivantes.
        if (currentAlign == 1) {
          sunmi.sendRawBytes(new byte[] {0x1B, 0x61, 0x01});
        }
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
