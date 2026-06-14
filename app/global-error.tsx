"use client";

import { useEffect, useState } from "react";

/**
 * Filet de sécurité ULTIME : intercepte les exceptions levées dans le layout
 * racine lui-même (là où `app/error.tsx` ne peut rien). Il remplace tout le
 * document → il doit fournir ses propres <html>/<body> et ne peut PAS compter
 * sur Tailwind/globals.css (styles inline uniquement).
 *
 * Comme `error.tsx`, il est réseau-conscient et retente automatiquement le
 * rendu quand la connexion revient (mode avion / coupure data).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    const onOnline = () => {
      setOffline(false);
      reset();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", sync);
    };
  }, [reset]);

  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#F5F3FB",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          color: "#1A1A1A",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "360px",
            background: "#fff",
            border: "1px solid #E7E3F0",
            borderRadius: "14px",
            padding: "24px",
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              margin: "0 auto 16px",
              borderRadius: "9999px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: offline ? "#F0EBFB" : "#FEF3C7",
              fontSize: "22px",
            }}
            aria-hidden
          >
            {offline ? "📶" : "⚠️"}
          </div>

          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>
            {offline ? "Pas de connexion" : "Une erreur est survenue"}
          </h1>
          <p
            style={{
              marginTop: "8px",
              fontSize: "14px",
              lineHeight: 1.5,
              color: "#6B6B72",
            }}
          >
            {offline
              ? "Vérifiez votre Wi-Fi ou vos données mobiles. La page se rechargera dès le retour du réseau."
              : "Un problème est survenu pendant le chargement. Vous pouvez réessayer."}
          </p>

          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "24px",
              height: "40px",
              padding: "0 20px",
              border: "none",
              borderRadius: "10px",
              background: "#6C2BD9",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
