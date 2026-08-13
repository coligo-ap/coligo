"use client";

import { useEffect, useRef } from "react";

// =============================================================================
// Champ anti-bot partagé — à poser DANS un <form> d'inscription / de reset.
// =============================================================================
// Deux couches, zéro friction humaine :
//   1. HONEYPOT (toujours actif) : champ invisible que seuls les robots
//      remplissent — vérifié côté serveur via honeypotTripped() (lib/security).
//   2. CLOUDFLARE TURNSTILE (si NEXT_PUBLIC_TURNSTILE_SITE_KEY est défini) :
//      captcha invisible en mode « interaction-only » — le widget n'apparaît
//      que si Cloudflare doute, sinon il valide en silence. Le token est posté
//      dans le champ caché `cf-turnstile-response` (convention Cloudflare),
//      vérifié côté serveur via verifyTurnstileToken().
// Sans clé publique, le composant ne rend QUE le honeypot : l'intégration est
// donc déployable avant la création du widget Cloudflare.
// Fonctionne dans la WebView Capacitor : l'app charge coligo.app en HTTPS,
// Turnstile voit le même hostname que le web.
// =============================================================================

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: Record<string, unknown>
      ) => string | undefined;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null; // ré-essayable au prochain montage
      reject(new Error("turnstile script failed"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function TurnstileField() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    const el = slotRef.current;
    if (!el) return;
    let widgetId: string | undefined;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(el, {
          sitekey: siteKey,
          // Invisible tant que Cloudflare ne doute pas ; le widget insère
          // lui-même le champ caché `cf-turnstile-response` dans le <form>.
          appearance: "interaction-only",
          theme: "auto",
          "response-field": true,
          "response-field-name": "cf-turnstile-response",
          // Token expiré (5 min) → re-résolution silencieuse.
          "refresh-expired": "auto",
        });
      })
      .catch(() => {
        // Script bloqué/injoignable : le serveur reste fail-open côté captcha,
        // les rate limits et le honeypot couvrent derrière.
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  return (
    <>
      {/* Honeypot — hors écran (pas display:none, que certains bots savent
          détecter), jamais focusable, ignoré des lecteurs d'écran. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute start-[-9999px] top-auto h-0 w-0 overflow-hidden"
      >
        <label>
          Ne pas remplir
          <input
            type="text"
            name="coligo_hp_website"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>
      {siteKey ? <div ref={slotRef} /> : null}
    </>
  );
}
