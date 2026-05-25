package com.coligo.app.sunmi;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.os.RemoteException;
import android.util.Log;

import androidx.annotation.Nullable;

import woyou.aidlservice.jiuiv5.ICallback;
import woyou.aidlservice.jiuiv5.IWoyouService;

/**
 * Wrapper autour du service AIDL d'impression Sunmi
 * (`woyou.aidlservice.jiuiv5.IWoyouService`).
 *
 * Le service est pré-installé sur les terminaux Sunmi (V1/V2/T2/T2 Mini/V3).
 * Sur tout autre appareil Android, le bind échoue silencieusement et
 * {@link #isReady()} renvoie {@code false} — c'est ce qui permet à
 * {@code SunmiPrinterPlugin.isAvailable()} d'informer le JS.
 *
 * Toutes les opérations passent par un callback {@link ICallback} muet : on
 * ne propage pas les erreurs item-par-item au JS pour ne pas bombarder le
 * pont sur des dizaines de commandes par ticket — l'état global est suivi
 * via {@link #lastError}.
 */
public final class SunmiService {
  private static final String TAG = "SunmiService";
  private static final String SERVICE_PACKAGE = "woyou.aidlservice.jiuiv5";
  private static final String SERVICE_ACTION = "woyou.aidlservice.jiuiv5.IWoyouService";

  private final Context context;
  @Nullable private IWoyouService service;
  private boolean bindAttempted;
  @Nullable private volatile String lastError;

  private final ServiceConnection connection =
      new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
          service = IWoyouService.Stub.asInterface(binder);
          Log.i(TAG, "Sunmi printer service connected");
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
          service = null;
          Log.w(TAG, "Sunmi printer service disconnected");
        }
      };

  public SunmiService(Context context) {
    this.context = context.getApplicationContext();
  }

  /**
   * Tente de se lier au service Sunmi. Idempotent — un seul bind par cycle
   * de vie de l'app. Sur appareil non-Sunmi, le bind échoue immédiatement.
   */
  public boolean tryBind() {
    if (bindAttempted) return service != null;
    bindAttempted = true;
    try {
      Intent intent = new Intent();
      intent.setPackage(SERVICE_PACKAGE);
      intent.setAction(SERVICE_ACTION);
      boolean ok = context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
      if (!ok) {
        Log.i(TAG, "Sunmi printer service unavailable on this device");
        lastError = "service-unavailable";
        return false;
      }
      return true;
    } catch (SecurityException | IllegalArgumentException e) {
      Log.w(TAG, "Sunmi bind failed", e);
      lastError = e.getMessage();
      return false;
    }
  }

  public boolean isReady() {
    return service != null;
  }

  @Nullable
  public String getLastError() {
    return lastError;
  }

  /** Callback no-op — on consomme silencieusement les retours du SDK. */
  private static final ICallback SILENT_CALLBACK =
      new ICallback.Stub() {
        @Override
        public void onRunResult(boolean isSuccess) {}

        @Override
        public void onReturnString(String result) {}

        @Override
        public void onRaiseException(int code, String msg) {
          Log.w(TAG, "Sunmi raise " + code + ": " + msg);
        }

        @Override
        public void onPrintResult(int code, String msg) {
          if (code != 0) Log.w(TAG, "Sunmi printResult " + code + ": " + msg);
        }
      };

  // --- API ---------------------------------------------------------------

  public void printerInit() throws RemoteException {
    requireService().printerInit(SILENT_CALLBACK);
  }

  public void setAlignment(int alignment) throws RemoteException {
    requireService().setAlignment(alignment, SILENT_CALLBACK);
  }

  /**
   * Le firmware Sunmi V3 rejette certaines tailles intermédiaires avec
   * « -5: Illegal parameter » (observé : 22, 30 → KO ; 20, 24, 28, 32 → OK).
   * On snap à la valeur autorisée la plus proche pour que le builder JS
   * puisse rester flexible sans connaître la liste par cœur.
   */
  private static final float[] ALLOWED_FONT_SIZES = {
      16f, 20f, 24f, 28f, 32f, 36f, 40f, 48f, 56f
  };

  public void setFontSize(float size) throws RemoteException {
    float snapped = ALLOWED_FONT_SIZES[0];
    float bestDist = Math.abs(size - snapped);
    for (float a : ALLOWED_FONT_SIZES) {
      float d = Math.abs(size - a);
      if (d < bestDist) {
        bestDist = d;
        snapped = a;
      }
    }
    if (snapped != size) {
      Log.i(TAG, "setFontSize " + size + " → " + snapped + " (snapped to allowed)");
    }
    requireService().setFontSize(snapped, SILENT_CALLBACK);
  }

  public void printText(String text) throws RemoteException {
    requireService().printText(text, SILENT_CALLBACK);
  }

  public void printTextWithFont(String text, String typeface, float size) throws RemoteException {
    requireService().printTextWithFont(text, typeface, size, SILENT_CALLBACK);
  }

  public void printColumnsText(String[] cols, int[] widths, int[] aligns) throws RemoteException {
    requireService().printColumnsText(cols, widths, aligns, SILENT_CALLBACK);
  }

  public void printQRCode(String data, int moduleSize, int errorLevel) throws RemoteException {
    requireService().printQRCode(data, moduleSize, errorLevel, SILENT_CALLBACK);
  }

  public void lineWrap(int n) throws RemoteException {
    requireService().lineWrap(n, SILENT_CALLBACK);
  }

  public void cutPaper() throws RemoteException {
    requireService().cutPaper(SILENT_CALLBACK);
  }

  public void sendRawBytes(byte[] data) throws RemoteException {
    requireService().sendRAWData(data, SILENT_CALLBACK);
  }

  public void enterBuffer(boolean clean) throws RemoteException {
    requireService().enterPrinterBuffer(clean);
  }

  public void exitBuffer(boolean commit) throws RemoteException {
    requireService().exitPrinterBuffer(commit);
  }

  public void commitBuffer() throws RemoteException {
    requireService().commitPrinterBufferWithCallback(SILENT_CALLBACK);
  }

  private IWoyouService requireService() throws RemoteException {
    IWoyouService s = service;
    if (s == null) throw new RemoteException("Sunmi printer service not bound");
    return s;
  }
}
