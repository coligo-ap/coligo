import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        FirebaseApp.configure()
        Messaging.messaging().delegate = self
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Push notifications (pont APNs → FCM)
    //
    // Capacitor ne swizzle PAS ces deux méthodes (contrairement à `open url` /
    // `continue userActivity` ci-dessus, qui passent par ApplicationDelegateProxy) :
    // @capacitor/push-notifications attend qu'on poste nous-mêmes les
    // notifications `.capacitorDidRegisterForRemoteNotifications` /
    // `.capacitorDidFailToRegisterForRemoteNotifications` (cf.
    // PushNotificationsPlugin.swift, qui les écoute depuis `load()`).
    //
    // `FirebaseAppDelegateProxyEnabled=false` (Info.plist) désactive le
    // swizzling automatique de Firebase sur ces mêmes méthodes : on garde un
    // seul point d'entrée déterministe, cohérent avec l'absence de swizzling
    // côté Capacitor.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        // ⚠️ BUG CORRIGÉ (23/07/2026) : on postait ICI le token APNs BRUT (Data)
        // sur `.capacitorDidRegisterForRemoteNotifications`. Le plugin Capacitor
        // émettait alors l'event `registration` avec le token APNs (hex), que le
        // JS (lib/native/push.ts, promesse one-shot) capturait AVANT que le
        // token FCM n'arrive → c'est le token APNs qui était stocké et envoyé à
        // l'API FCM HTTP v1 → **INVALID_ARGUMENT** (FCM refuse un token APNs).
        // Résultat : AUCUNE push iOS ne partait, et les tokens étaient purgés.
        //
        // On ne fait donc PLUS QUE mapper APNs↔FCM ici. Le SEUL token relayé au
        // JS est le token FCM, posté dans `didReceiveRegistrationToken` — c'est
        // celui-là, et lui seul, que le backend attend.
        Messaging.messaging().apnsToken = deviceToken

        // ROBUSTESSE : le délégué `didReceiveRegistrationToken` peut avoir déjà
        // émis le token FCM à `FirebaseApp.configure()` (token en cache), AVANT
        // que le JS n'ait attaché son écouteur. Comme `register()` déclenche
        // toujours ce callback-ci, on redemande le token EXPLICITEMENT et on le
        // repousse : le JS (qui vient d'appeler register) le reçoit à coup sûr.
        Messaging.messaging().token { token, _ in
            if let token = token {
                NotificationCenter.default.post(
                    name: .capacitorDidRegisterForRemoteNotifications,
                    object: token
                )
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // Le token que `lib/native/push.ts` envoie au serveur (`/api/device-tokens`)
    // doit être un token FCM (le backend envoie via l'API HTTP v1 FCM, cf.
    // lib/fcm/send.ts) — pas le token APNs brut. On relaie donc le VRAI token
    // FCM au JS en réutilisant le même canal `registration` : le plugin gère
    // déjà la branche `String` de cette notification (cf.
    // PushNotificationsPlugin.didRegisterForRemoteNotificationsWithDeviceToken).
    // Ce callback peut refeu si le token est régénéré (rotation) : le JS
    // n'écoute qu'une fois par appel, mais chaque montage du shell relance
    // `registerPushToken`, donc le token à jour finit toujours par être
    // renvoyé au serveur.
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: fcmToken)
    }

}
