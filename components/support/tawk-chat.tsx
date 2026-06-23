"use client";

import { useEffect } from "react";

/**
 * Intégration Tawk.to (live chat support GRATUIT) — espaces CLIENT, LIVREUR et
 * COMMERÇANT.
 *
 * Stratégie « zéro intrusion » :
 *  - Tawk n'est JAMAIS chargé au chargement d'une page. Aucun widget, aucun
 *    lanceur, aucun « flash » du bouton de chat qui apparaît puis disparaît.
 *  - Le script Tawk est chargé À LA DEMANDE, uniquement quand l'utilisateur
 *    clique « Aide & support » / « Contacter le support » → openSupportChat(),
 *    qui ouvre alors directement la fenêtre de chat.
 *  - <TawkChat> ne fait que MÉMORISER le contexte (rôle + identité) pour qu'au
 *    moment de l'ouverture, l'agent humain ait tout le contexte : nom, e-mail,
 *    tél, RÔLE (Client/Livreur/Commerçant) en attribut + tag, et attributs
 *    additionnels (id, n° de commande, statut, boutique…).
 *
 * Compte gratuit sur tawk.to puis dans .env(.local) ET sur Vercel :
 *   NEXT_PUBLIC_TAWK_PROPERTY_ID=<property id>
 *   NEXT_PUBLIC_TAWK_WIDGET_ID=<widget id>        (optionnel — « default » sinon)
 *   NEXT_PUBLIC_SUPPORT_EMAIL=support@coligo.dz   (optionnel — repli si chat KO)
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
};

export type SupportRole = "client" | "livreur" | "commercant";

/** Attributs additionnels libres (valeurs converties en chaînes pour Tawk). */
export type SupportAttributes = Record<
  string,
  string | number | boolean | null | undefined
>;

const ROLE_LABEL: Record<SupportRole, string> = {
  client: "Client",
  livreur: "Livreur",
  commercant: "Commerçant",
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

/** Pose le contexte (identité + rôle + extras) sur l'API Tawk déjà chargée. */
function applyContext(w: TawkWindow, extra?: SupportAttributes) {
  try {
    const attrs = cleanAttrs({
      name: ctx?.name,
      email: ctx?.email,
      phone: ctx?.phone,
      role: ctx ? ROLE_LABEL[ctx.role] : undefined,
      ...(ctx?.attributes ?? {}),
      ...(extra ?? {}),
    });
    if (Object.keys(attrs).length) w.Tawk_API?.setAttributes?.(attrs, () => {});
    if (ctx) w.Tawk_API?.addTags?.([ROLE_LABEL[ctx.role]], () => {});
  } catch {
    /* ignore */
  }
}

/**
 * Ouvre le chat support. Charge Tawk À LA DEMANDE s'il ne l'est pas encore
 * (jamais au chargement de page). Repli e-mail si Tawk n'est pas configuré.
 */
export function openSupportChat(opts?: {
  orderRef?: string | null;
  attributes?: SupportAttributes;
}): void {
  if (typeof window === "undefined") return;
  const w = window as TawkWindow;
  const extra: SupportAttributes = {
    ...(opts?.attributes ?? {}),
    ...(opts?.orderRef ? { commande: opts.orderRef } : {}),
  };

  // 1) Déjà chargé → on pose les attributs + on ouvre directement.
  if (w.__tawkLoaded && typeof w.Tawk_API?.maximize === "function") {
    try {
      applyContext(w, extra);
      w.Tawk_API.showWidget?.();
      w.Tawk_API.maximize();
      return;
    } catch {
      /* repli ci-dessous */
    }
  }

  // 2) Pas encore chargé mais Tawk configuré → on charge MAINTENANT, puis on
  //    ouvre la fenêtre dès que prêt (onLoad). Le lanceur flottant reste masqué.
  if (PROPERTY_ID) {
    w.Tawk_API = w.Tawk_API || {};
    w.Tawk_API.onLoad = function () {
      try {
        applyContext(w, extra);
        w.Tawk_API?.showWidget?.();
        w.Tawk_API?.maximize?.();
      } catch {
        /* ignore */
      }
    };
    // Réduire le chat → re-masquer le lanceur (pas de bulle flottante résiduelle).
    w.Tawk_API.onChatMinimized = function () {
      try {
        w.Tawk_API?.hideWidget?.();
      } catch {
        /* ignore */
      }
    };
    // Si un chargement est déjà en cours (double-clic), onLoad ouvrira — on sort.
    if (document.getElementById("tawk-embed")) return;
    w.Tawk_LoadStart = new Date();
    const s = document.createElement("script");
    s.id = "tawk-embed";
    s.async = true;
    s.src = `https://embed.tawk.to/${PROPERTY_ID}/${WIDGET_ID}`;
    s.charset = "UTF-8";
    s.setAttribute("crossorigin", "*");
    s.onload = () => {
      w.__tawkLoaded = true;
    };
    document.body.appendChild(s);
    return;
  }

  // 3) Tawk non configuré → repli e-mail.
  const mail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  if (mail) {
    const subject = opts?.orderRef
      ? `Aide commande ${opts.orderRef} — Coligo`
      : "Aide Coligo";
    window.location.href = `mailto:${mail}?subject=${encodeURIComponent(
      subject
    )}`;
  }
}

export function TawkChat({
  role,
  name,
  email,
  phone,
  attributes,
}: {
  role: SupportRole;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Attributs additionnels propres au rôle (id, boutique, vérifié…). */
  attributes?: SupportAttributes;
}) {
  const attrKey = JSON.stringify(attributes ?? {});

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, name, email, phone, attrKey]);

  return null;
}
