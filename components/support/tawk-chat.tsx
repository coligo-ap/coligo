"use client";

import { useEffect } from "react";

/**
 * Intégration Tawk.to (live chat support GRATUIT) — espaces CLIENT et LIVREUR.
 *
 * Stratégie « propre » :
 *  - Chargé UNIQUEMENT si configuré (NEXT_PUBLIC_TAWK_PROPERTY_ID) — sinon no-op.
 *  - Le LANCEUR flottant par défaut est MASQUÉ (il chevaucherait les barres de
 *    navigation/onglets des PWA). On ouvre le chat exclusivement via un bouton
 *    « Contacter le support » → openSupportChat().
 *  - Contexte injecté (nom, e-mail, rôle) pour que l'agent sache à qui il parle.
 *
 * Créer un compte gratuit sur tawk.to puis renseigner dans .env(.local) :
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
  setAttributes?: (
    attrs: Record<string, string | undefined>,
    cb?: (err?: unknown) => void
  ) => void;
};
type TawkWindow = Window & {
  Tawk_API?: TawkApi;
  Tawk_LoadStart?: Date;
  __tawkLoaded?: boolean;
};

export function isSupportConfigured(): boolean {
  return !!PROPERTY_ID || !!process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
}

/** Ouvre le chat support (le lanceur par défaut étant masqué). Repli e-mail. */
export function openSupportChat(opts?: { orderRef?: string | null }): void {
  if (typeof window === "undefined") return;
  const w = window as TawkWindow;
  const api = w.Tawk_API;
  if (api && typeof api.maximize === "function") {
    try {
      if (opts?.orderRef) {
        api.setAttributes?.({ commande: opts.orderRef }, () => {});
      }
      api.showWidget?.();
      api.maximize();
      return;
    } catch {
      /* repli ci-dessous */
    }
  }
  const mail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  if (mail) {
    window.location.href = `mailto:${mail}?subject=${encodeURIComponent(
      "Aide commande Coligo"
    )}`;
  }
}

export function TawkChat({
  role,
  name,
  email,
}: {
  role: "client" | "livreur";
  name?: string | null;
  email?: string | null;
}) {
  useEffect(() => {
    if (!PROPERTY_ID) return;
    const w = window as TawkWindow;

    const setAttrs = () => {
      try {
        w.Tawk_API?.setAttributes?.(
          {
            name: name || undefined,
            email: email || undefined,
            role,
          },
          () => {}
        );
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
  }, [role, name, email]);

  return null;
}
