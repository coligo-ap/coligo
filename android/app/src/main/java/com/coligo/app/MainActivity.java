package com.coligo.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.coligo.app.calls.IncomingCallNotifier;
import com.coligo.app.intro.IntroSplashView;
import com.coligo.app.sunmi.SunmiPrinterPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

  private static final String TAG = "ColigoIntro";

  /**
   * Garde-fou ultime. Si ni la page ni l'erreur ne se manifestent (réseau qui
   * pend, moteur de rendu mort), l'intro se retire quand même. Sans ça, un
   * overlay coincé rendrait l'app inutilisable jusqu'à la prochaine mise à jour.
   */
  private static final long HARD_TIMEOUT_MS = 8000;

  private IntroSplashView intro;
  private boolean animationDone;
  private boolean pageVisible;
  private final Handler ui = new Handler(Looper.getMainLooper());

  /** État des barres système, à restaurer quand l'intro s'efface. */
  private int savedStatusBar;
  private int savedNavBar;
  private boolean savedLightStatus;
  private boolean savedLightNav;
  private boolean barsOverridden;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Plugins natifs locaux : enregistrés avant super.onCreate pour que le
    // pont Capacitor les expose à `Capacitor.Plugins.*` dès le premier load.
    registerPlugin(SunmiPrinterPlugin.class);
    super.onCreate(savedInstanceState);

    // ── BARRE DE STATUT INTÉGRÉE (edge-to-edge), comme Snapchat/Instagram ──
    // La WebView peint SOUS les barres système ; le CSS réserve déjà la place
    // avec env(safe-area-inset-*) sur chaque en-tête/nav (règle du repo).
    // Sans ça, Android peint une bande unie (grise) au-dessus du contenu.
    // Les icônes système (heure/batterie) sont mises en contraste
    // DYNAMIQUEMENT depuis le web (plugin @capacitor/status-bar) selon la
    // couleur réellement présente sous la barre.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.TRANSPARENT);

    // Intro de marque — SEULEMENT au vrai démarrage à froid.
    //
    // `savedInstanceState != null` signifie que l'activité est RECRÉÉE : Android
    // a tué le processus en arrière-plan et l'utilisateur revient, ou l'écran a
    // tourné. C'est exactement le cas où l'intro ne doit pas rejouer. Côté web
    // il fallait un délai de garde en localStorage pour approcher ce signal ;
    // ici Android nous le donne exactement.
    if (savedInstanceState == null) {
      installIntro();
    }

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

    // Appel entrant : lancée par la notification plein écran → l'activité
    // doit s'afficher PAR-DESSUS l'écran verrouillé, écran rallumé.
    maybeShowOverLockscreen(getIntent());
  }

  /**
   * Ouverture depuis la notification d'appel (full-screen intent / Répondre) :
   * s'afficher sur l'écran verrouillé et rallumer l'écran — comportement
   * téléphone standard (Messenger/WhatsApp). API 27+ ; en dessous, l'utilisateur
   * déverrouille normalement, l'invitation ré-émise affiche l'appel entrant.
   */
  private void maybeShowOverLockscreen(Intent intent) {
    try {
      if (intent == null
          || !intent.getBooleanExtra(IncomingCallNotifier.EXTRA_CALL, false)) {
        return;
      }
      if (Build.VERSION.SDK_INT >= 27) {
        setShowWhenLocked(true);
        setTurnScreenOn(true);
      }
    } catch (Throwable e) {
      Log.w(TAG, "showWhenLocked impossible", e);
    }
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    maybeShowOverLockscreen(intent);
  }

  @Override
  public void onResume() {
    super.onResume();
    // App au premier plan → la sonnerie in-app (overlay web) prend le relais :
    // on efface la notification d'appel native (son + vibration stoppés).
    IncomingCallNotifier.cancel(this);
  }

  /**
   * Pose l'intro par-dessus la WebView et branche ses conditions de sortie.
   *
   * L'animation tourne PENDANT le chargement de l'URL distante, elle ne s'y
   * ajoute pas — c'est tout l'intérêt du natif. On ne retire l'overlay que si
   * les DEUX conditions sont vraies : l'animation est finie, et la page a peint
   * sa première frame (`onPageCommitVisible`). Sinon on découvrirait un écran
   * vide au milieu du chargement.
   */
  private void installIntro() {
    try {
      // La DecorView, pas android.R.id.content : `content` s'arrête SOUS la
      // barre de statut. Les nappes de couleur éclaircissent le haut de la
      // scène, la barre resterait donc à sa couleur unie → une bande visible.
      // On peint sous les barres, et on les rend transparentes le temps de
      // l'intro. La DecorView dessine leur fond APRÈS ses enfants : sans cette
      // transparence, l'overlay serait recouvert.
      ViewGroup root = (ViewGroup) getWindow().getDecorView();
      if (root == null) return;

      savedStatusBar = getWindow().getStatusBarColor();
      savedNavBar = getWindow().getNavigationBarColor();
      getWindow().setStatusBarColor(Color.TRANSPARENT);
      getWindow().setNavigationBarColor(Color.TRANSPARENT);

      // La scène est BLANCHE. Les icônes système (heure, réseau, batterie) sont
      // claires par défaut sur cette app : blanches sur blanc, elles
      // disparaîtraient. On les passe en sombre le temps de l'intro.
      WindowInsetsControllerCompat bars =
          WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
      savedLightStatus = bars.isAppearanceLightStatusBars();
      savedLightNav = bars.isAppearanceLightNavigationBars();
      bars.setAppearanceLightStatusBars(true);
      bars.setAppearanceLightNavigationBars(true);
      barsOverridden = true;

      intro = new IntroSplashView(this);
      root.addView(intro,
          new ViewGroup.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT,
              ViewGroup.LayoutParams.MATCH_PARENT));

      Log.i(TAG, "overlay ajoute a la DecorView");
      intro.play(new Runnable() {
        @Override
        public void run() {
          Log.i(TAG, "animation terminee");
          animationDone = true;
          maybeDismiss();
        }
      });

      getBridge().addWebViewListener(new WebViewListener() {
        /** Première frame réellement peinte par la WebView. */
        @Override
        public void onPageCommitVisible(WebView view, String url) {
          signalPageVisible();
        }

        /**
         * Repli. `onPageCommitVisible` n'existe qu'à partir d'API 23 et n'est
         * pas garanti sur tous les moteurs ; sans ce second signal, on
         * attendrait le garde-fou de 8 s.
         */
        @Override
        public void onPageLoaded(WebView webView) {
          signalPageVisible();
        }

        // PAS de hook sur onReceivedError. Piège : BridgeWebViewClient notifie
        // les listeners pour TOUTES les requêtes en échec, pas seulement la
        // frame principale (le test `isForMainFrame` n'intervient qu'après,
        // pour charger errorPath). Une simple image manquante effacerait donc
        // l'intro en plein vol. Hors ligne, `server.errorPath` charge
        // offline.html, dont le premier paint déclenche onPageCommitVisible :
        // l'intro se retire normalement et laisse voir l'écran hors-ligne.
      });

      ui.postDelayed(new Runnable() {
        @Override
        public void run() {
          if (intro != null && !intro.isDismissed()) intro.dismiss(restoreBars);
        }
      }, HARD_TIMEOUT_MS);
    } catch (Throwable e) {
      // Une intro ratée ne doit JAMAIS empêcher l'app de démarrer — mais elle
      // ne doit pas non plus échouer en SILENCE : c'est exactement ce qui a
      // masqué le wordmark invisible de la v7, invisible aussi dans logcat.
      Log.e(TAG, "intro non installée", e);
      if (intro != null) intro.remove();
      intro = null;
      restoreBars.run();
    }
  }

  /**
   * Remet les barres système dans leur état d'origine. Idempotent : appelé à la
   * fin du fondu, par le garde-fou, et par onDestroy — au pire des cas, la
   * barre resterait transparente et laisserait voir le windowBackground blanc,
   * ce qui n'est pas cassé, juste moins joli.
   */
  private final Runnable restoreBars = new Runnable() {
    @Override
    public void run() {
      if (!barsOverridden) return;
      barsOverridden = false;
      try {
        // On garde les barres TRANSPARENTES (edge-to-edge permanent) : restaurer
        // `savedStatusBar` redonnait la bande opaque grise après l'intro.
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat bars =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(savedLightStatus);
        bars.setAppearanceLightNavigationBars(savedLightNav);
      } catch (Exception ignored) {
        /* fenêtre déjà détruite */
      }
    }
  };

  private void signalPageVisible() {
    ui.post(new Runnable() {
      @Override
      public void run() {
        if (!pageVisible) Log.i(TAG, "page visible");
        pageVisible = true;
        maybeDismiss();
      }
    });
  }

  private void maybeDismiss() {
    if (intro == null || intro.isDismissed()) return;
    if (animationDone && pageVisible) intro.dismiss(restoreBars);
  }

  /**
   * Écrit les cookies de la WebView sur le disque.
   *
   * POURQUOI : Android garde les cookies en mémoire et ne les persiste qu'à
   * intervalles. Un « swipe kill » tue le processus avant cette écriture — et
   * la session Supabase, qui vit dans des cookies (`@supabase/ssr`), disparaît.
   * L'utilisateur rouvrait l'app déconnecté, alors que ses cookies portent bien
   * un `Max-Age` de 380 jours (cf. `lib/supabase/session-config.ts`).
   *
   * `onPause()` est le dernier point de vie GARANTI par Android : `onStop()` et
   * `onDestroy()` peuvent ne jamais être appelés si le système tue le processus.
   */
  private void flushCookies() {
    try {
      CookieManager.getInstance().flush();
    } catch (Throwable e) {
      // Une WebView pas encore initialisée ne doit pas faire tomber l'activité.
      Log.w(TAG, "flush des cookies impossible", e);
    }
  }

  @Override
  public void onPause() {
    super.onPause();
    flushCookies();
  }

  // `public` et non `protected` : BridgeActivity l'expose en public, un
  // override plus restrictif ne compile pas.
  @Override
  public void onDestroy() {
    flushCookies();
    ui.removeCallbacksAndMessages(null);
    restoreBars.run();
    intro = null;
    super.onDestroy();
  }
}
