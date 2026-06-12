/* Service worker Firebase Cloud Messaging — push web/PWA (navigateur, app non
 * installée). Reçoit les push même onglet fermé tant que le navigateur tourne.
 *
 * La config Firebase (publique) est passée en query string au moment de
 * l'enregistrement (lib/native/push-web.ts) → ce fichier reste statique et
 * n'a pas besoin des variables d'env au build. Enregistré sur le scope dédié
 * `/firebase-cloud-messaging-push-scope` pour NE PAS entrer en conflit avec le
 * service worker PWA (`/sw.js`, scope racine).
 */
 
importScripts(
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js"
);

const params = new URL(self.location).searchParams;
const config = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

if (
  config.apiKey &&
  config.projectId &&
  config.messagingSenderId &&
  config.appId
) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  // Push reçue alors que la page n'est pas au premier plan → on affiche la
  // notification système. `data.route` sert au clic (cf. notificationclick).
  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    const data = payload.data || {};
    const title = n.title || data.title || "Coligo";
    const body = n.body || data.body || "";
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { route: data.route || "/" },
    });
  });
}

// Clic sur la notification → focus de l'onglet existant (ou ouverture) sur la
// route portée par le payload.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route =
    (event.notification.data && event.notification.data.route) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          if ("focus" in w) {
            if ("navigate" in w) {
              try {
                w.navigate(route);
              } catch {
                /* cross-origin / non navigable : on se contente du focus */
              }
            }
            return w.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(route);
      })
  );
});
