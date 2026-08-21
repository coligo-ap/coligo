"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SupportSheet } from "./support-sheet";

/**
 * Intégration Tawk.to (live chat support GRATUIT) — TOUS les espaces : CLIENT,
 * LIVREUR, CHAUFFEUR, COMMERÇANT et AGENT COLIGO PAY.
 *
 * Stratégie « zéro intrusion » :
 *  - Tawk n'est JAMAIS chargé au chargement d'une page. Aucun widget, aucun
 *    lanceur, aucun « flash » du bouton de chat qui apparaît puis disparaît.
 *  - Le script Tawk est chargé À LA DEMANDE, uniquement quand l'utilisateur
 *    clique « Aide & support » / « Contacter le support » → openSupportChat(),
 *    qui ouvre alors directement la fenêtre de chat.
 *  - <TawkChat> ne fait que MÉMORISER le contexte (rôle + identité) pour qu'au
 *    moment de l'ouverture, l'agent humain ait TOUT le contexte sans poser de
 *    question :
 *      • RÔLE (Client / Livreur / Chauffeur / Commerçant / Agent Coligo Pay)
 *        en attribut + TAG (filtrable côté Tawk),
 *      • IDENTIFIANT de connexion (e-mail) + nom + téléphone,
 *      • PAGE d'origine (libellé lisible + chemin) — d'où vient la demande,
 *      • attributs métier passés par le bouton appelant (n° de commande, course,
 *        statut, boutique, montant…), fusionnés intelligemment,
 *      • PRIORITÉ : une demande urgente (course/livraison en cours, incident)
 *        remonte en PREMIER avec un TAG « 🔴 URGENT » et un nom préfixé 🔴 pour
 *        être impossible à manquer dans la file Tawk.
 *
 * Compte gratuit sur tawk.to puis dans .env(.local) ET sur Vercel :
 *   NEXT_PUBLIC_TAWK_PROPERTY_ID=<property id>
 *   NEXT_PUBLIC_TAWK_WIDGET_ID=<widget id>        (optionnel — « default » sinon)
 *   NEXT_PUBLIC_SUPPORT_EMAIL=support@coligo.dz   (optionnel — repli si chat KO)
 *
 * Astuce Tawk : pour afficher le tag « 🔴 URGENT » en ROUGE dans le tableau de
 * bord, créer le tag côté Tawk (Administration → Tags) avec une couleur rouge —
 * ici on garantit juste que le tag + l'emoji 🔴 sont posés à chaque demande
 * urgente, et que ces conversations sont visuellement distinctes.
 */

const PROPERTY_ID = process.env.NEXT_PUBLIC_TAWK_PROPERTY_ID;
const WIDGET_ID = process.env.NEXT_PUBLIC_TAWK_WIDGET_ID || "default";

type TawkApi = {
  onLoad?: () => void;
  onChatMinimized?: () => void;
  hideWidget?: () => void;
  showWidget?: () => void;
  maximize?: () => void;
  addTags?: (tags: string[], cb?: (err?: unknown) => void) => void;
  setAttributes?: (
    attrs: Record<string, string>,
    cb?: (err?: unknown) => void
  ) => void;
};
type TawkWindow = Window & {
  Tawk_API?: TawkApi;
  Tawk_LoadStart?: Date;
  __tawkLoaded?: boolean;
  __tawkLauncher?: boolean; // bulle flottante (mode lanceur) activée
};

export type SupportRole =
  | "client"
  | "livreur"
  | "chauffeur"
  | "commercant"
  | "agent";

/** Attributs additionnels libres (valeurs converties en chaînes pour Tawk). */
export type SupportAttributes = Record<
  string,
  string | number | boolean | null | undefined
>;

const ROLE_LABEL: Record<SupportRole, string> = {
  client: "Client",
  livreur: "Livreur",
  chauffeur: "Chauffeur",
  commercant: "Commerçant",
  agent: "Agent Coligo Pay",
};

/** Tawk n'accepte que des chaînes : on filtre les vides et on convertit. */
function cleanAttrs(attrs: SupportAttributes): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = typeof v === "boolean" ? (v ? "oui" : "non") : String(v);
  }
  return out;
}

/**
 * Libellé LISIBLE de la page d'origine (pour que l'agent sache d'où vient la
 * demande sans décoder un chemin technique). On reconnaît les sections par
 * préfixe ; à défaut on renvoie le chemin brut. Le détail (n° commande/course)
 * est porté par les attributs métier, pas ici.
 */
function friendlyPage(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  const rules: [RegExp, string][] = [
    // Client
    [/^\/$/, "Accueil client"],
    [/^\/m\//, "Page boutique"],
    [/^\/produit\//, "Fiche produit"],
    [/^\/panier/, "Panier"],
    [/^\/checkout\/success/, "Confirmation de paiement"],
    [/^\/checkout\/failure/, "Échec de paiement"],
    [/^\/checkout/, "Paiement (checkout)"],
    [/^\/commandes\/[^/]+/, "Suivi d'une commande"],
    [/^\/commandes/, "Mes commandes"],
    [/^\/favoris/, "Favoris"],
    [/^\/adresses/, "Mes adresses"],
    [/^\/compte/, "Mon compte (client)"],
    [/^\/coligo-pay|^\/pay\b/, "Coligo Pay (client)"],
    [/^\/drive\/courses?\/[^/]+/, "Suivi d'une course (client)"],
    [/^\/drive/, "Coligo Drive (client)"],
    // Livreur
    [/^\/driver\/releve/, "Relevé livreur"],
    [/^\/driver\/recharger/, "Recharge portefeuille (livreur)"],
    [/^\/driver\/compte/, "Compte livreur"],
    [/^\/driver\/historique|^\/driver\/courses/, "Historique livreur"],
    [/^\/driver/, "Accueil livreur"],
    // Chauffeur
    [
      /^\/chauffeur\/course\/[^/]+|^\/chauffeur\/courses?\/[^/]+/,
      "Course en cours (chauffeur)",
    ],
    [/^\/chauffeur\/recharger/, "Recharge portefeuille (chauffeur)"],
    [/^\/chauffeur\/compte/, "Compte chauffeur"],
    [/^\/chauffeur\/historique/, "Historique chauffeur"],
    [/^\/chauffeur/, "Accueil chauffeur"],
    // Commerçant
    [/^\/dashboard/, "Tableau de bord commerçant"],
    [/^\/orders\/[^/]+/, "Détail commande (commerçant)"],
    [/^\/orders/, "Commandes (commerçant)"],
    [/^\/catalog/, "Catalogue (commerçant)"],
    [/^\/finances/, "Finances (commerçant)"],
    [/^\/parametres|^\/settings/, "Paramètres commerçant"],
    // Agent Coligo Pay
    [/^\/partenaire/, "Espace Agent Coligo Pay"],
  ];
  for (const [re, label] of rules) if (re.test(p)) return label;
  return p;
}

export function isSupportConfigured(): boolean {
  return !!PROPERTY_ID || !!process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
}

// Contexte courant (rôle + identité), posé par <TawkChat>. Sert à renseigner
// l'agent au moment de l'ouverture du chat. Aucun chargement de script ici.
let ctx: {
  role: SupportRole;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  attributes?: SupportAttributes;
} | null = null;

/** Options d'ouverture du chat — contexte métier + priorité. */
export type OpenSupportOptions = {
  /** Référence de commande (n° lisible) — raccourci de attributes.Commande. */
  orderRef?: string | null;
  /** Sujet court de la demande (ex. « Paiement », « Course en cours »). */
  subject?: string | null;
  /** URGENT : remonte en premier (tag rouge + nom préfixé 🔴). */
  priority?: "urgent" | "normal";
  /** Attributs métier additionnels (statut, boutique, montant, course…). */
  attributes?: SupportAttributes;
};

/**
 * Pose le contexte COMPLET (priorité + identité + rôle + page + métier) sur
 * l'API Tawk déjà chargée, dans un ORDRE volontaire (priorité → rôle →
 * identité → page → métier) pour une lecture immédiate par l'agent.
 */
function applyContext(w: TawkWindow, opts?: OpenSupportOptions) {
  try {
    const urgent = opts?.priority === "urgent";
    const baseName = ctx?.name?.trim() || (ctx ? ROLE_LABEL[ctx.role] : "—");
    const page =
      typeof window !== "undefined"
        ? friendlyPage(window.location.pathname)
        : "";

    // Ordre d'affichage voulu (les objets JS conservent l'ordre d'insertion ;
    // Tawk affiche généralement les attributs dans cet ordre).
    const ordered: SupportAttributes = {
      // 1) Priorité bien visible en tête.
      "⚑ Priorité": urgent ? "🔴 URGENT — à traiter en premier" : "Normale",
      // 2) Qui ? (rôle + nom affiché côté agent, préfixé 🔴 si urgent).
      name: urgent ? `🔴 URGENT · ${baseName}` : baseName,
      Rôle: ctx ? ROLE_LABEL[ctx.role] : undefined,
      // 3) Identifiants de contact.
      "Identifiant (e-mail)": ctx?.email,
      email: ctx?.email,
      phone: ctx?.phone,
      // 4) D'où vient la demande.
      Page: page,
      Chemin:
        typeof window !== "undefined" ? window.location.pathname : undefined,
      // 5) Sujet + n° commande (raccourcis pratiques).
      Sujet: opts?.subject ?? undefined,
      Commande: opts?.orderRef ?? undefined,
      // 6) Attributs propres au rôle (posés par <TawkChat>).
      ...(ctx?.attributes ?? {}),
      // 7) Attributs métier de l'écran appelant (statut, course, montant…).
      ...(opts?.attributes ?? {}),
    };

    const attrs = cleanAttrs(ordered);
    if (Object.keys(attrs).length) w.Tawk_API?.setAttributes?.(attrs, () => {});

    // Tags : rôle (toujours) + URGENT (en tête) + sujet court si fourni.
    const tags: string[] = [];
    if (urgent) tags.push("🔴 URGENT");
    if (ctx) tags.push(ROLE_LABEL[ctx.role]);
    if (opts?.subject) tags.push(opts.subject);
    if (tags.length) w.Tawk_API?.addTags?.(tags, () => {});
  } catch {
    /* ignore */
  }
}

/**
 * Injecte le script Tawk UNE seule fois (idempotent) et branche `onReady` sur
 * Tawk_API.onLoad. Si Tawk est déjà chargé, `onReady` est appelé tout de suite.
 * N'injecte rien si PROPERTY_ID est absent.
 */
function ensureTawkScript(
  w: TawkWindow,
  onReady: () => void,
  onFail?: () => void
): void {
  if (!PROPERTY_ID) {
    onFail?.();
    return;
  }
  w.Tawk_API = w.Tawk_API || {};
  // `__tawkLoaded` n'est posé QUE quand le widget est réellement prêt (onLoad
  // de Tawk), pas au chargement du fichier : le script est un simple
  // chargeur, il télécharge ensuite ses propres bundles. Se fier au onload du
  // <script> faisait croire le chat prêt alors que `maximize` n'existait pas.
  if (w.__tawkLoaded && typeof w.Tawk_API.maximize === "function") {
    onReady();
    return;
  }
  w.Tawk_API.onLoad = () => {
    w.__tawkLoaded = true;
    onReady();
  };
  if (document.getElementById("tawk-embed")) return; // chargement déjà en cours
  w.Tawk_LoadStart = new Date();
  const s = document.createElement("script");
  s.id = "tawk-embed";
  s.async = true;
  s.src = `https://embed.tawk.to/${PROPERTY_ID}/${WIDGET_ID}`;
  s.charset = "UTF-8";
  // PAS d'attribut `crossorigin` : l'extrait officiel de Tawk pose
  // `crossorigin="*"`, qui n'est pas une valeur valide (seules « anonymous »
  // et « use-credentials » le sont) et bascule le chargement en mode CORS. La
  // moindre réponse sans en-tête `Access-Control-Allow-Origin` — page d'erreur
  // Cloudflare, cache CDN sans `Vary: Origin` — fait alors ÉCHOUER le script,
  // et le bouton support ne faisait plus rien du tout. Un script tiers se
  // charge sans CORS.
  s.onerror = () => {
    // Bloqué (403 Cloudflare, bloqueur de pub, réseau d'entreprise, hors
    // ligne) : on le sait tout de suite et l'appelant propose l'e-mail.
    document.getElementById("tawk-embed")?.remove();
    onFail?.();
  };
  document.body.appendChild(s);
}

/** Événement d'ouverture de la feuille support (écouté par <SupportSheet>). */
export const SUPPORT_OPEN_EVENT = "coligo:support:open";

/**
 * URL du chat Tawk INTÉGRABLE (« Direct Chat Link ») — la même conversation
 * que le widget, mais servie comme une page autonome qu'on peut poser dans une
 * iframe À NOUS.
 *
 * Pourquoi pas le widget : `Tawk_API.maximize()` ouvre sur téléphone une
 * fenêtre PLEIN ÉCRAN qui recouvre l'app (barre du bas comprise) et casse la
 * superposition — l'utilisateur sort visuellement de Coligo. Ici le chat vit
 * DANS notre feuille : l'app reste visible derrière, la nav reste accessible.
 * Bonus : cette URL n'est pas soumise au chargement de script tiers qui se
 * fait bloquer (403 Cloudflare, bloqueurs), donc le chat marche là où le
 * widget échouait.
 */
export function tawkChatUrl(opts?: OpenSupportOptions): string | null {
  if (!PROPERTY_ID) return null;
  const base = `https://tawk.to/chat/${PROPERTY_ID}/${WIDGET_ID}`;
  // La page popout de Tawk lit `?tags=` et les repasse à `addTags()` : c'est
  // le seul canal de contexte disponible en mode intégré (le JS API du widget
  // ne s'applique pas à cette page). On y met de quoi router et prioriser la
  // conversation sans que le client ait à se présenter.
  const tags = [
    opts?.priority === "urgent" ? "🔴 URGENT" : null,
    ctx ? ROLE_LABEL[ctx.role] : null,
    opts?.subject ?? null,
    opts?.orderRef ? `Commande ${opts.orderRef}` : null,
  ].filter(Boolean) as string[];
  if (!tags.length) return base;
  return `${base}?tags=${encodeURIComponent(tags.join(","))}`;
}

/**
 * OUVRE LE SUPPORT — point d'entrée unique de toute l'app (des dizaines de
 * boutons l'appellent). Depuis le 12/08/2026 il n'ouvre plus la fenêtre Tawk
 * en aveugle : il ouvre NOTRE feuille (contexte rappelé, sujet à qualifier,
 * canaux), d'où part ensuite le chat ou l'e-mail.
 *
 * Pourquoi : Tawk est un tiers qui peut être bloqué (403 Cloudflare, bloqueur
 * de pub, réseau d'entreprise, hors ligne). Dans ce cas le bouton ne faisait
 * RIEN — aucun retour, aucune alternative. Désormais il se passe TOUJOURS
 * quelque chose, et le repli e-mail garde tout le contexte.
 */
export function openSupportChat(opts?: OpenSupportOptions): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SUPPORT_OPEN_EVENT, { detail: opts ?? {} })
  );
}

/** Délai au-delà duquel on considère que le chat ne s'ouvrira pas. */
const TAWK_TIMEOUT_MS = 9_000;

/**
 * Lance le CHAT EN DIRECT (Tawk) avec tout le contexte. Rappelle `done(true)`
 * quand la fenêtre est réellement ouverte, `done(false)` si c'est impossible
 * (non configuré, script bloqué, délai dépassé) — l'appelant bascule alors sur
 * l'e-mail. Utilisé par <SupportSheet>.
 */
export function startTawkChat(
  opts: OpenSupportOptions | undefined,
  done: (ok: boolean) => void
): void {
  if (typeof window === "undefined") return done(false);
  const w = window as TawkWindow;

  const openNow = (): boolean => {
    try {
      applyContext(w, opts);
      w.Tawk_API?.showWidget?.();
      w.Tawk_API?.maximize?.();
      return true;
    } catch {
      return false;
    }
  };

  // 1) Déjà prêt → on ouvre tout de suite.
  if (w.__tawkLoaded && typeof w.Tawk_API?.maximize === "function") {
    return done(openNow());
  }

  if (!PROPERTY_ID) return done(false);

  // 2) Chargement à la demande, BORNÉ : sans échéance, un script qui ne
  //    répond jamais laissait le client sur un bouton qui tourne dans le vide.
  let settled = false;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    done(ok);
  };
  const timer = window.setTimeout(() => finish(false), TAWK_TIMEOUT_MS);

  ensureTawkScript(
    w,
    () => finish(openNow()),
    () => finish(false)
  );

  // Réduire le chat → re-masquer la bulle : aucun résidu flottant à l'écran
  // (règle produit : le chat est ON-DEMAND, jamais de bulle permanente).
  w.Tawk_API = w.Tawk_API || {};
  w.Tawk_API.onChatMinimized = function () {
    try {
      w.Tawk_API?.hideWidget?.();
    } catch {
      /* ignore */
    }
  };
}

/**
 * Lien `mailto:` de repli, sujet ET corps pré-remplis avec TOUT le contexte
 * (rôle, identité, page, commande, attributs métier) — l'agent reçoit par
 * e-mail exactement ce qu'il aurait vu dans Tawk. `null` si aucune adresse
 * n'est configurée.
 */
export function supportMailto(opts?: OpenSupportOptions): string | null {
  const mail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  if (!mail) return null;
  const role = ctx ? ROLE_LABEL[ctx.role] : "Coligo";
  const bits = [
    opts?.priority === "urgent" ? "URGENT" : null,
    role,
    opts?.subject ?? null,
    opts?.orderRef ? `Commande ${opts.orderRef}` : null,
  ].filter(Boolean);
  const subject = bits.length
    ? `[${bits.join(" · ")}] Aide Coligo`
    : "Aide Coligo";

  const lines: string[] = [
    "",
    "",
    "— Informations transmises automatiquement —",
  ];
  const info = cleanAttrs({
    Rôle: role,
    Nom: ctx?.name,
    "E-mail": ctx?.email,
    Téléphone: ctx?.phone,
    Page:
      typeof window !== "undefined"
        ? friendlyPage(window.location.pathname)
        : undefined,
    Sujet: opts?.subject,
    Commande: opts?.orderRef,
    ...(ctx?.attributes ?? {}),
    ...(opts?.attributes ?? {}),
  });
  for (const [k, v] of Object.entries(info)) lines.push(`${k} : ${v}`);

  return `mailto:${mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

/**
 * Charge le widget Tawk en mode LANCEUR (bulle flottante visible), en différé,
 * sans bloquer le rendu. Idempotent. À n'appeler QUE sur les espaces où le
 * lanceur doit être visible (client, commerçant) — voir <TawkChat launcher>.
 */
export function loadTawkLauncher(): void {
  if (typeof window === "undefined" || !PROPERTY_ID) return;
  const w = window as TawkWindow;
  w.__tawkLauncher = true;
  ensureTawkScript(w, function () {
    try {
      applyContext(w); // identité/rôle courants, sans ouvrir la fenêtre
      w.Tawk_API?.showWidget?.();
    } catch {
      /* ignore */
    }
  });
}

/** Affiche/masque la bulle du lanceur (gating par route). No-op si pas chargé. */
export function setTawkLauncherVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  const w = window as TawkWindow;
  if (!w.__tawkLoaded) return;
  try {
    if (visible) w.Tawk_API?.showWidget?.();
    else w.Tawk_API?.hideWidget?.();
  } catch {
    /* ignore */
  }
}

export function TawkChat({
  role,
  name,
  email,
  phone,
  attributes,
  launcher = false,
  hideOnPaths,
}: {
  role: SupportRole;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Attributs additionnels propres au rôle (id, boutique, vérifié…). */
  attributes?: SupportAttributes;
  /** Mode LANCEUR : bulle flottante visible, chargée en différé. */
  launcher?: boolean;
  /** Routes où le lanceur est masqué (checkout, course en cours…). */
  hideOnPaths?: RegExp[];
}) {
  const attrKey = JSON.stringify(attributes ?? {});
  const pathname = usePathname();

  useEffect(() => {
    // On NE charge PAS Tawk ici : on mémorise seulement le contexte pour que
    // openSupportChat (au clic « Aide & support ») charge + ouvre le chat avec
    // les bons attributs. → le widget ne s'affiche JAMAIS au chargement de page.
    ctx = { role, name, email, phone, attributes };
    // Si l'utilisateur a déjà ouvert le chat puis navigué (Tawk chargé), on
    // rafraîchit les attributs en silence (sans rien ré-afficher).
    if (typeof window !== "undefined") {
      const w = window as TawkWindow;
      if (w.__tawkLoaded) applyContext(w);
    }
    // attrKey couvre les changements d'`attributes` (objet littéral).
    // attrKey couvre les changements d'`attributes` (objet littéral).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, name, email, phone, attrKey]);

  // La feuille support est montée ICI : <TawkChat> est déjà présent dans les
  // 5 espaces (client, livreur, chauffeur, commerçant, agent), donc tous
  // héritent de la même porte d'entrée sans montage supplémentaire.

  // Mode LANCEUR : charge Tawk en différé (idle) et gère sa visibilité par route.
  // La bulle est masquée sur les écrans où elle gênerait (checkout, course).
  useEffect(() => {
    if (!launcher || !PROPERTY_ID || typeof window === "undefined") return;
    const hidden = (hideOnPaths ?? []).some((re) => re.test(pathname || "/"));
    const w = window as TawkWindow;
    if (hidden) {
      setTawkLauncherVisible(false);
      return;
    }
    if (w.__tawkLoaded) {
      setTawkLauncherVisible(true);
      return;
    }
    // 1re fois : charger pendant un temps mort, sans bloquer le rendu.
    const ric = (
      window as unknown as {
        requestIdleCallback?: (
          cb: () => void,
          o?: { timeout: number }
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    if (ric) {
      const id = ric(() => loadTawkLauncher(), { timeout: 4000 });
      return () => {
        (
          window as unknown as { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(() => loadTawkLauncher(), 2500);
    return () => window.clearTimeout(t);
  }, [launcher, pathname, hideOnPaths]);

  return <SupportSheet />;
}
