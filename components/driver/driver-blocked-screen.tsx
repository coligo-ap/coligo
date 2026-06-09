import { DriverBottomNav } from "@/components/driver/driver-bottom-nav";

/**
 * Écran « compte bloqué » (sanction DURE). Contrairement au gel, le livreur
 * n'a AUCUN accès à ses pages : quel que soit l'onglet, il ne voit que ce
 * message. On garde toutefois la barre de navigation visible (cf. demande) —
 * elle reste cliquable mais chaque page re-affiche ce blocage.
 */
export function DriverBlockedScreen({ reason }: { reason?: string | null }) {
  return (
    <div
      className="mq-screen flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center"
      style={{ paddingBottom: 90 }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--red-soft)",
          marginBottom: 16,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: 34, height: 34, stroke: "var(--red)" }}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M5.6 5.6l12.8 12.8" />
        </svg>
      </div>
      <h1
        className="mq-sora"
        style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}
      >
        Compte bloqué
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--muted)",
          maxWidth: 320,
          lineHeight: 1.55,
        }}
      >
        Votre compte est bloqué. Merci de prendre contact avec le support pour
        résoudre le problème.
      </p>
      {reason ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
          Motif : {reason}
        </p>
      ) : null}
      <DriverBottomNav />
    </div>
  );
}
