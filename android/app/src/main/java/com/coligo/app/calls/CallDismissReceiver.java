package com.coligo.app.calls;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * « Refuser » sur la notification d'appel : on efface simplement la
 * notification (sonnerie + vibration s'arrêtent). L'appelant, qui ré-émet son
 * invitation, abandonne de lui-même au bout de 30 s (« Pas de réponse ») —
 * aucun aller-retour réseau nécessaire côté natif.
 */
public class CallDismissReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    IncomingCallNotifier.cancel(context);
  }
}
