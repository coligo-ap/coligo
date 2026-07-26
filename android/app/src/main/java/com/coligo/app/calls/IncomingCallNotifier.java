package com.coligo.app.calls;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;

import java.util.Map;

/**
 * Notification « appel entrant » style téléphone (Messenger/WhatsApp) :
 *
 *  - canal dédié IMPORTANCE_HIGH avec SONNERIE système + vibration insistante ;
 *  - NotificationCompat.CallStyle (Android 12+ : grande carte Répondre/Refuser ;
 *    versions antérieures : notification haute avec les deux actions) ;
 *  - full-screen intent : écran verrouillé / app fermée → l'app s'ouvre PLEIN
 *    ÉCRAN sur l'écran de la course/commande (deep link https://coligo.app/…,
 *    relayé à la SPA par AppUrlListener). L'appelant ré-émet son invitation
 *    pendant 30 s → l'écran d'appel entrant apparaît dès l'ouverture ;
 *  - « Refuser » : simple dismiss local (l'appelant abandonne à 30 s) ;
 *  - timeout 35 s : jamais de notification d'appel fantôme.
 *
 * Données attendues (push FCM data-only, cf. lib/fcm/send.ts sendFcmCall) :
 * type=coligo_call, route=/drive|/chauffeur/course|/commandes/<id>,
 * caller=<nom affiché>, video=0|1.
 */
public final class IncomingCallNotifier {

  public static final String CHANNEL_ID = "coligo_calls";
  public static final int NOTIF_ID = 60217;
  /** Extra posé sur l'intent d'ouverture → MainActivity s'affiche sur l'écran verrouillé. */
  public static final String EXTRA_CALL = "coligo_call";

  private IncomingCallNotifier() {}

  public static void show(Context ctx, Map<String, String> data) {
    String caller = data.get("caller");
    if (caller == null || caller.trim().isEmpty()) caller = "Coligo";
    String route = data.get("route");
    if (route == null || !route.startsWith("/")) route = "/";
    boolean video = "1".equals(data.get("video"));

    ensureChannel(ctx);

    // Répondre / toucher / plein écran : ouvre l'app sur l'écran concerné via
    // le deep link vérifié coligo.app (AppUrlListener → navigation SPA).
    Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("https://coligo.app" + route));
    open.setClass(ctx, com.coligo.app.MainActivity.class);
    open.putExtra(EXTRA_CALL, true);
    open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    PendingIntent answer = PendingIntent.getActivity(
        ctx, 1, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    PendingIntent decline = PendingIntent.getBroadcast(
        ctx, 2, new Intent(ctx, CallDismissReceiver.class),
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Person person = new Person.Builder().setName(caller).setImportant(true).build();

    NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(ctx.getApplicationInfo().icon)
        .setContentTitle(caller)
        .setContentText(video ? "Appel vidéo entrant…" : "Appel entrant…")
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
        .setFullScreenIntent(answer, true)
        .setContentIntent(answer)
        .setTimeoutAfter(35_000);

    try {
      NotificationManagerCompat.from(ctx).notify(NOTIF_ID, b.build());
    } catch (SecurityException ignored) {
      // POST_NOTIFICATIONS refusée : rien à faire, l'appel reste joignable
      // en ouvrant l'app (l'invitation est ré-émise pendant 30 s).
    }
  }

  /** Efface la notification d'appel (app revenue au premier plan). */
  public static void cancel(Context ctx) {
    try {
      NotificationManagerCompat.from(ctx).cancel(NOTIF_ID);
    } catch (Exception ignored) {
      /* jamais bloquant */
    }
  }

  /**
   * Canal SONNERIE : son d'appel système (pas le « ding » de notification),
   * vibration insistante, bypass Ne-pas-déranger refusé (comportement appel
   * standard). Créé une fois — Android fige ensuite ses réglages.
   */
  private static void ensureChannel(Context ctx) {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm =
        (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;

    NotificationChannel ch = new NotificationChannel(
        CHANNEL_ID, "Appels Coligo", NotificationManager.IMPORTANCE_HIGH);
    ch.setDescription("Appels entrants (client, chauffeur, commerçant)");
    ch.setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
    ch.enableVibration(true);
    ch.setVibrationPattern(new long[] {0, 900, 500, 900, 500, 900});
    ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
    nm.createNotificationChannel(ch);
  }
}
