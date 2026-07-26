package com.coligo.app.calls;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Service FCM de l'app — étend celui du plugin Capacitor push-notifications
 * pour intercepter les pushes DATA « appel entrant » (type=coligo_call) AVANT
 * la chaîne normale.
 *
 * Pourquoi : une push « notification » classique app fermée finit dans le tiroir
 * système — aucune sonnerie plein écran. Une push DATA haute priorité, elle,
 * réveille CE service même processus tué → on affiche nous-mêmes la
 * notification d'appel style téléphone (CallStyle + full-screen intent),
 * exactement comme Messenger/WhatsApp.
 *
 * Déclaré dans le manifest de l'APP (prioritaire sur celui du plugin au merge).
 * Tout ce qui n'est pas un appel repart dans le comportement Capacitor normal
 * (super.onMessageReceived) — zéro régression sur les autres pushes.
 */
public class CallMessagingService
    extends com.capacitorjs.plugins.pushnotifications.MessagingService {

  @Override
  public void onMessageReceived(RemoteMessage remoteMessage) {
    Map<String, String> data = remoteMessage.getData();
    if ("coligo_call".equals(data.get("type"))) {
      IncomingCallNotifier.show(getApplicationContext(), data);
      return; // pas de doublon dans le tiroir de notifications
    }
    super.onMessageReceived(remoteMessage);
  }
}
