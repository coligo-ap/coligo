package com.coligo.app;

import android.os.Bundle;

import com.coligo.app.sunmi.SunmiPrinterPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Plugins natifs locaux : enregistrés avant super.onCreate pour que le
    // pont Capacitor les expose à `Capacitor.Plugins.*` dès le premier load.
    registerPlugin(SunmiPrinterPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
