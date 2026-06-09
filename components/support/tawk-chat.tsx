"use client";

import { useEffect } from "react";

/**
 * Intégration Tawk.to (live chat support GRATUIT) — espaces CLIENT, LIVREUR et
 * COMMERÇANT.
 *
 * Stratégie « propre » :
 *  - Chargé UNIQUEMENT si configuré (NEXT_PUBLIC_TAWK_PROPERTY_ID) — sinon no-op.
 *  - Le LANCEUR flottant par défaut est MASQUÉ (il chevaucherait les barres de
 *    navigation/onglets des PWA). On ouvre le chat exclusivement via un bouton
 *    « Aide & support » / « Contacter le support » → openSupportChat().
 *  - Contexte MAX injecté pour l'agent humain : identité (nom, e-mail, tél),
 *    RÔLE (Client / Livreur / Commerçant) posé en attribut ET en tag, plus tout
 *    attribut additionnel (id, n° de commande, statut, boutique…). Objectif :
 *    l'agent sait immédiatement à qui il parle et sur quoi.
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

/**
 * Ouvre le chat support (le lanceur par défaut étant masqué). On peut joindre
 * un n° de commande (`orderRef`) et tout attribut additionnel pour l'agent.
 * Repli e-mail si le chat n'est pas chargé.
 */
export function openSupportChat(opts?: {
  orderRef?: string | null;
  attributes?: SupportAttributes;
}): void {
  if (typeof window === "undefined") return;
  const w = window as TawkWindow;
  const api = w.Tawk_API;
  if (api && typeof api.maximize === "function") {
    try {
      const attrs = cleanAttrs({
        ...(opts?.attributes ?? {}),
        ...(opts?.orderRef ? { commande: opts.orderRef } : {}),
      });
      if (Object.keys(attrs).length) api.setAttributes?.(attrs, () => {});
      api.showWidget?.();
      api.maximize();
      return;
    } catch {
      /* repli ci-dessous */
    }
  }
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
  // Clé stable pour ne pas re-déclencher l'effet à chaque rendu d'un objet
  // littéral identique (les attributs viennent d'un Server Component).
  const attrKey = JSON.stringify(attributes ?? {});

  useEffect(() => {
    if (!PROPERTY_ID) return;
    const w = window as TawkWindow;

    const setAttrs = () => {
      try {
        const attrs = cleanAttrs({
          name,
          email,
          phone,
          role: ROLE_LABEL[role],
          ...(attributes ?? {}),
        });
        w.Tawk_API?.setAttributes?.(attrs, () => {});
        // Tag de rôle → l'agent filtre/route instantanément Client/Livreur/Commerçant.
        w.Tawk_API?.addTags?.([ROLE_LABEL[role]], () => {});
      } catch {
        /* ignore */
      }
    };

    // Déjà chargé (navigation interne) → juste (re)poser les attributs.
    if (w.__tawkLoaded) {
      setAttrs();
      return;
    }

    w.Tawk_API = w.Tawk_API || {};
    const prevOnLoad = w.Tawk_API.onLoad;
    w.Tawk_API.onLoad = function () {
      try {
        w.Tawk_API?.hideWidget?.(); // masque le lanceur flottant
      } catch {
        /* ignore */
      }
      setAttrs();
      prevOnLoad?.();
    };
    // Quand l'utilisateur réduit le chat, on re-masque le lanceur.
    w.Tawk_API.onChatMinimized = function () {
      try {
        w.Tawk_API?.hideWidget?.();
      } catch {
        /* ignore */
      }
    };

    if (!document.getElementById("tawk-embed")) {
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
    }
    // attrKey couvre les changements d'`attributes` (objet littéral).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, name, email, phone, attrKey]);

  return null;
}
