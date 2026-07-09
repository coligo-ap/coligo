import styles from "./intro-splash.module.css";

/**
 * Intro splash Coligo — animation d'ouverture de l'application.
 *
 * Contraintes tenues (dans l'ordre où elles ont été demandées) :
 *
 * 1. « ne doit pas retarder l'affichage de l'app » — le composant est un
 *    SERVER COMPONENT : zéro octet de JS applicatif, zéro hydratation, zéro
 *    dépendance (pas de Lottie). L'animation est 100 % CSS et démarre au tout
 *    premier paint. L'app se charge DERRIÈRE, pendant l'intro : l'overlay ne
 *    bloque rien, il recouvre. Coût réseau : la seule image est le wordmark de
 *    marque, déjà en cache HTTP la plupart du temps.
 *
 * 2. « ne doit pas rejouer quand l'utilisateur revient après avoir quitté
 *    brièvement » — deux verrous. `sessionStorage` couvre le cas normal (la
 *    page n'est pas rechargée, donc rien ne se remonte). Le vrai risque, c'est
 *    Android qui détruit le WebView en arrière-plan et RECHARGE la page au
 *    retour : `sessionStorage` peut alors avoir disparu. D'où l'horodatage en
 *    `localStorage` avec un délai de garde (INTRO_COOLDOWN_MS). Il est écrit
 *    AU DÉBUT de l'intro, pas à la fin — un rechargement pendant l'animation
 *    ne la rejoue donc pas non plus.
 *
 * 3. « natif ou web » — l'intro ne se déclenche que dans une app installée
 *    (WebView Capacitor, ou PWA en display-mode standalone). Sur une visite
 *    normale du site en navigateur, jamais : un splash sur un site web dégrade
 *    le LCP et n'a aucun sens. `?intro=1` force l'affichage (test terrain),
 *    `?intro=0` le neutralise.
 *
 * Fail-safe : l'overlay est `display:none` par défaut et n'est révélé que si le
 * script de garde pose `data-intro="on"` sur <html>. JS coupé, storage bloqué,
 * script en erreur → aucune intro, jamais d'écran bloqué. Le script de fin
 * retire l'attribut sur `animationend`, avec un filet de sécurité par timeout.
 */

/** Silhouette blanche du wordmark « Coligo ». Doit rester synchronisé avec
 *  `--wordmark` dans intro-splash.module.css (le CSS ne lit pas le TS). */
const WORDMARK_SRC = "/brand/logo-fr-white.png";

/** Fin de l'animation (overlayOut : 1180 ms de délai + 320 ms). */
const INTRO_DURATION_MS = 1500;

/** Filet de sécurité armé À PARTIR de `animationstart` (fin du délai de
 *  `overlayOut`), et non du parse : le premier calcul de style peut arriver
 *  très tard si une feuille du <head> tarde, et un délai compté depuis le parse
 *  couperait l'animation en plein vol. Passé ce délai l'overlay est déjà
 *  transparent mais capte encore les taps — il ne doit pas traîner. */
const INTRO_FAILSAFE_MS = 600;

/** Garde-fou ultime : si `animationstart` n'arrive jamais (CSS non appliquée,
 *  animations coupées par le système), on démonte quand même. */
const INTRO_HARD_FAILSAFE_MS = 6000;

/**
 * Délai de garde entre deux intros. Tant qu'il n'est pas écoulé, un
 * relancement de l'app ne rejoue PAS l'animation — c'est ce qui protège du cas
 * « je quitte 2 minutes, je reviens ».
 *
 * 30 min = l'intro se voit au vrai démarrage de la journée, jamais sur un
 * aller-retour. Pour ne la montrer qu'UNE SEULE FOIS dans la vie de
 * l'installation, mettre `Number.MAX_SAFE_INTEGER`.
 */
const INTRO_COOLDOWN_MS = 30 * 60 * 1000;

const SESSION_KEY = "coligo:intro:seen";
const STAMP_KEY = "coligo:intro:at";

/** Décide AVANT le premier paint. Doit rester minuscule et sans dépendance. */
const GUARD_SCRIPT = `
(function(){
  try{
    var d = document.documentElement;
    if (d.getAttribute('data-intro')) return;

    var q = '';
    try { q = window.location.search || ''; } catch(e) {}
    if (q.indexOf('intro=0') > -1) return;
    var forced = q.indexOf('intro=1') > -1;

    if (!forced) {
      // Trois signaux, un seul suffit. Le premier est le SEUL fiable dans un
      // APK : il vient du serveur (cookie posé par /api/start/<role>), donc il
      // est déjà dans le HTML. Les deux autres dépendent du JS et peuvent
      // arriver trop tard — le pont Capacitor n'est pas garanti injecté quand
      // ce script s'exécute, et une détection ratée = <body> blanc à l'écran.
      var marked = d.getAttribute('data-app') === 'native';
      var cap = window.Capacitor;
      var native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
      var standalone = false;
      try {
        standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
          || window.navigator.standalone === true;
      } catch(e) {}
      if (!marked && !native && !standalone) return;

      // Pas de garde sur document.visibilityState : au démarrage à froid d'un
      // WebView Android, le document est parsé avant que la vue ne soit
      // attachée — la page se déclare 'hidden' et l'intro ne jouerait jamais
      // sur téléphone. Le filtre natif/standalone suffit à écarter le web.

      try { if (sessionStorage.getItem('${SESSION_KEY}') === '1') return; } catch(e) {}
      try {
        var last = parseInt(localStorage.getItem('${STAMP_KEY}') || '0', 10);
        if (last && Date.now() - last < ${INTRO_COOLDOWN_MS}) return;
      } catch(e) {}
    }

    try { sessionStorage.setItem('${SESSION_KEY}', '1'); } catch(e) {}
    try { localStorage.setItem('${STAMP_KEY}', String(Date.now())); } catch(e) {}

    d.setAttribute('data-intro', 'on');

    // Démarre le téléchargement du wordmark avant même que le <img> ne soit
    // parsé : l'animation en a besoin dès la frame 0.
    var l = document.createElement('link');
    l.rel = 'preload'; l.as = 'image'; l.href = '${WORDMARK_SRC}';
    l.setAttribute('fetchpriority', 'high');
    document.head.appendChild(l);
  } catch(e) {}
})();
`;

/** Arme l'image, puis démonte l'overlay à la fin de l'animation. */
const TEARDOWN_SCRIPT = `
(function(){
  try{
    var d = document.documentElement;
    if (d.getAttribute('data-intro') !== 'on') return;

    var root = document.getElementById('coligo-intro');
    if (!root) return;

    var img = root.querySelector('img[data-src]');
    if (img) {
      img.addEventListener('load', function(){ root.setAttribute('data-ready','1'); }, { once: true });
      img.src = img.getAttribute('data-src');
      if (img.complete) root.setAttribute('data-ready','1');
    }

    var done = false;
    var hard = setTimeout(finish, ${INTRO_HARD_FAILSAFE_MS});
    var soft = 0;

    function finish(){
      if (done) return;
      done = true;
      clearTimeout(hard); clearTimeout(soft);
      root.removeEventListener('animationend', onEnd);
      root.removeEventListener('animationstart', onStart);
      d.removeAttribute('data-intro'); // → l'overlay repasse en display:none
    }
    // Les animations des enfants (nappes, halo…) remontent aussi : on ne
    // réagit qu'à celle portée par l'overlay lui-même, c'est-à-dire la sortie.
    function onEnd(e){ if (e.target === root) finish(); }
    function onStart(e){
      if (e.target !== root) return;
      clearTimeout(hard);
      soft = setTimeout(finish, ${INTRO_FAILSAFE_MS});
    }

    root.addEventListener('animationstart', onStart);
    root.addEventListener('animationend', onEnd);
  } catch(e) {}
})();
`;

export function IntroSplash() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: GUARD_SCRIPT }} />

      {/* `suppressHydrationWarning` : TEARDOWN_SCRIPT pose `data-ready` ici et
          `src` sur l'image AVANT que React n'hydrate. Sans ça, React signale
          des attributs serveur/client divergents (« won't be patched up »).
          Aucun rendu ultérieur ne touche ce sous-arbre — statique par nature. */}
      <div
        id="coligo-intro"
        className={styles.overlay}
        role="presentation"
        aria-hidden="true"
        suppressHydrationWarning
      >
        <div className={`${styles.aurora} ${styles.auroraRose}`} />
        <div className={`${styles.aurora} ${styles.auroraViolet}`} />
        <div className={styles.grain} />
        {/* Raccord avec l'écran de lancement natif : aplat #4C1B9B qui se
            dissout pour laisser éclore le dégradé. cf. --seam dans le CSS. */}
        <div className={styles.seam} />

        <div className={styles.stage}>
          <div className={styles.glow} />

          {/* Deux arcs en orbite. Circonférences exactes pour le tracé :
              r=86 → 540,35 ; r=104 → 653,45 (cf. stroke-dasharray du CSS). */}
          <svg
            className={styles.ring}
            viewBox="0 0 240 240"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id="coligoRingA" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#FF2D7A" stopOpacity="0" />
                <stop offset="55%" stopColor="#FF2D7A" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="coligoRingB" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C4A5FF" stopOpacity="0" />
                <stop offset="100%" stopColor="#C4A5FF" stopOpacity="0.85" />
              </linearGradient>
            </defs>
            <circle
              className={styles.ringOuter}
              cx="120"
              cy="120"
              r="86"
              stroke="url(#coligoRingA)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle
              className={styles.ringInner}
              cx="120"
              cy="120"
              r="104"
              stroke="url(#coligoRingB)"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          </svg>

          <div className={styles.lockup}>
            {/* `src` posé par TEARDOWN_SCRIPT : sans lui, les visiteurs web —
                pour qui l'overlay reste display:none — téléchargeraient l'image
                pour rien (un <img src> caché est quand même récupéré). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.mark}
              data-src={WORDMARK_SRC}
              width={800}
              height={275}
              alt=""
              decoding="sync"
              fetchPriority="high"
              suppressHydrationWarning
            />
            <div className={styles.sweep} />
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: TEARDOWN_SCRIPT }} />
    </>
  );
}

export { INTRO_DURATION_MS, INTRO_COOLDOWN_MS, INTRO_HARD_FAILSAFE_MS };
