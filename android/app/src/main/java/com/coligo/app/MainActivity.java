package com.coligo.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.coligo.app.sunmi.SunmiPrinterPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Plugins natifs locaux : enregistrés avant super.onCreate pour que le
    // pont Capacitor les expose à `Capacitor.Plugins.*` dès le premier load.
    registerPlugin(SunmiPrinterPlugin.class);
    super.onCreate(savedInstanceState);

    // Permission Caméra runtime — requise pour que `getUserMedia()` côté JS
    // (scan QR de retrait) puisse démarrer. Capacitor 8 gère la demande de
    // permission WebView via son BridgeWebChromeClient.onPermissionRequest()
    // qui appelle ActivityCompat — on pré-demande au boot pour éviter le
    // dialogue lors du 1er scan.
    //
    // FLAVOR commerce UNIQUEMENT : le scan QR est le cœur du métier commerçant
    // (validation des retraits sur Sunmi). Côté flavor client (Google Play),
    // demander la caméra au démarrage serait hors-contexte (recommandations
    // Play : permission au moment de l'usage) — la demande part à la première
    // prise caméra réelle (paiement QR, appel vidéo), gérée par Capacitor.
    if ("commerce".equals(BuildConfig.FLAVOR)
        && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(this,
          new String[] {Manifest.permission.CAMERA}, 1001);
    }
  }
}
