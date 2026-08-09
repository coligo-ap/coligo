"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import {
  Loader2,
  MapPin,
  Navigation,
  Settings,
  ShieldCheck,
} from "lucide-react";
import {
  VIOLET,
  RED,
  PrimaryBtn,
  GhostBtn,
} from "@/components/customer/drive/drive-modals";
import {
  canOpenAppSettings,
  openAppSettings,
  openLocationSettings,
} from "@/lib/native";
import type { LocationGateStatus } from "@/lib/hooks/use-location-gate";

// =============================================================================
// LocationRequiredScreen — écran BLOQUANT « localisation obligatoire ».
// =============================================================================
// PARTAGÉ chauffeur + livreur (même règle métier, même écran : un seul endroit
// à corriger). Overlay plein écran z-[200] : il recouvre la barre de nav
// persistante, le bandeau de course et les feuilles — on ne travaille pas sans
// position, donc rien ne doit rester atteignable derrière.
//
// La session N'EST PAS fermée : le partenaire reste connecté (une course en
// cours reste clôturable) mais il est mis HORS LIGNE et ne reçoit plus rien.
// C'est le comportement des grandes apps de VTC/livraison.
//
// Deux chemins selon la cause :
//  - "prompt"  → bouton qui déclenche le DIALOGUE SYSTÈME ;
//  - "denied"  → l'OS ne réaffiche plus rien : bouton vers les RÉGLAGES ;
//  - "off"     → le service de localisation du téléphone est éteint : bouton
//                vers les réglages de POSITION du système.
// Sur le web (pas d'APK), aucun bouton ne peut ouvrir de réglages : on affiche
// la marche à suivre écrite.
// =============================================================================

export function LocationRequiredScreen({
  status,
  busy,
  onRequest,
  onRecheck,
  onLogout,
  role,
}: {
  status: LocationGateStatus;
  busy: boolean;
  /** Déclenche le dialogue système d'autorisation. */
  onRequest: () => void;
  /** Relit permission + position (retour depuis les réglages). */
  onRecheck: () => void;
  /**
   * Déconnexion — porte de sortie SECONDAIRE, jamais automatique. Retourne un
   * message d'erreur à afficher INLINE (le serveur refuse la déconnexion tant
   * qu'une course est en cours), ou `null` si la déconnexion part.
   */
  onLogout: () => Promise<string | null>;
  role: "chauffeur" | "livreur";
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [opening, setOpening] = useState(false);
  // Sur le web, ou si l'APK installé est antérieur au plugin, l'ouverture des
  // réglages échoue → on bascule DÉFINITIVEMENT sur les instructions écrites.
  const [settingsFailed, setSettingsFailed] = useState(false);
  // Déconnexion : état LOCAL au bouton + message INLINE (le serveur la refuse
  // tant qu'une course est en cours) — jamais de toast.
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout() {
    setLogoutError(null);
    setLogoutPending(true);
    try {
      const err = await onLogout();
      if (err) setLogoutError(err);
    } finally {
      setLogoutPending(false);
    }
  }

  const serviceOff = status === "off";
  const canOpen = canOpenAppSettings() && !settingsFailed;

  async function goToSettings() {
    setOpening(true);
    try {
      const ok = serviceOff
        ? await openLocationSettings()
        : await openAppSettings();
      if (!ok) setSettingsFailed(true);
    } finally {
      setOpening(false);
    }
  }

  const appName =
    role === "chauffeur"
      ? "Coligo Drive"
      : tr("Coligo Livreur", "كوليغو موصّل");

  const title = serviceOff
    ? tr("Activez la localisation", "فعّل تحديد الموقع")
    : tr("Localisation obligatoire", "تحديد الموقع إلزامي");

  const lead = serviceOff
    ? tr(
        `Le service de localisation de votre téléphone est éteint. ${appName} ne peut pas vous placer sur la carte.`,
        `خدمة تحديد الموقع في هاتفك مُطفأة. لا يستطيع ${appName} تحديد موقعك على الخريطة.`
      )
    : tr(
        `${appName} ne fonctionne pas sans votre position exacte.`,
        `لا يعمل ${appName} بدون موقعك الدقيق.`
      );

  // Étapes écrites — seul recours quand aucun bouton ne peut ouvrir les
  // réglages (web, ou APK antérieur au plugin).
  const steps = serviceOff
    ? [
        tr("Ouvrez les Réglages du téléphone", "افتح إعدادات الهاتف"),
        tr("Position (ou Localisation)", "الموقع (أو تحديد الموقع)"),
        tr("Activez la position", "فعّل الموقع"),
      ]
    : [
        tr("Ouvrez les Réglages du téléphone", "افتح إعدادات الهاتف"),
        tr("Applications › Coligo", "التطبيقات › كوليغو"),
        tr("Autorisations › Position", "الأذونات › الموقع"),
        tr("Choisissez « Toujours autoriser »", "اختر « السماح دائمًا »"),
      ];

  return (
    // z-[200] : au-dessus de la carte (z-[80..95]) et des bandeaux (z-[120..140]),
    // sous la garde de connexion (z-[300]) — un vrai « pas de réseau » doit
    // rester visible par-dessus.
    <div className="drive-jakarta drive-page fixed inset-0 z-[200] overflow-y-auto bg-[var(--d-surface)] px-5 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-[360px]">
        <div className="text-center">
          <span
            className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
            style={{
              background: serviceOff
                ? "var(--color-danger-tint)"
                : "var(--d-accent)",
            }}
          >
            {serviceOff ? (
              <Navigation className="size-7" style={{ color: RED }} />
            ) : (
              <MapPin className="size-7" style={{ color: VIOLET }} />
            )}
          </span>
          <h1 className="drive-sora text-display-sm font-extrabold">{title}</h1>
          <p className="text-body-sm mx-auto mt-1 max-w-[300px] text-[var(--d-muted)]">
            {lead}
          </p>
        </div>

        {/* Pourquoi c'est obligatoire — trois raisons concrètes, pas un
            paragraphe. Un partenaire qui comprend accepte. */}
        <div className="rounded-card-xl mt-4 border border-[var(--d-line)] p-3">
          <Reason
            title={tr("Recevoir des courses", "استقبال المشاوير")}
            sub={tr(
              "Les demandes vont au partenaire le plus proche",
              "تُرسل الطلبات إلى أقرب شريك"
            )}
          />
          <Reason
            title={tr("Être suivi par le client", "تتبّع الزبون لك")}
            sub={tr(
              "Il voit votre approche en temps réel",
              "يرى اقترابك في الوقت الفعلي"
            )}
          />
          <Reason
            title={tr("Prouver vos trajets", "إثبات مشاويرك")}
            sub={tr(
              "Distances et gains calculés sur le trajet réel",
              "تُحتسب المسافات والأرباح على المسار الحقيقي"
            )}
            last
          />
        </div>

        {/* ACTION PRINCIPALE. Jamais demandée → dialogue système. Refusée ou
            service éteint → réglages du téléphone (l'OS ne redemandera plus). */}
        {status === "prompt" ? (
          <PrimaryBtn onClick={onRequest} disabled={busy}>
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <MapPin className="size-5" />
            )}
            {tr("Autoriser la localisation", "السماح بتحديد الموقع")}
          </PrimaryBtn>
        ) : canOpen ? (
          <PrimaryBtn onClick={() => void goToSettings()} disabled={opening}>
            {opening ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Settings className="size-5" />
            )}
            {tr("Ouvrir les réglages", "فتح الإعدادات")}
          </PrimaryBtn>
        ) : null}

        {/* Marche à suivre écrite : affichée quand aucun bouton ne peut ouvrir
            les réglages — c'est alors le SEUL chemin, pas un complément. */}
        {status !== "prompt" && !canOpen && (
          <ol className="rounded-card-xl mt-3 border border-[var(--d-line)] p-3">
            {steps.map((s, i) => (
              <li
                key={s}
                className="text-body-sm flex items-center gap-2.5 py-1 font-semibold"
              >
                <span
                  className="text-caption grid size-[22px] shrink-0 place-items-center rounded-full font-bold"
                  style={{ background: "var(--d-soft)" }}
                >
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        )}

        {/* Retour des réglages : en natif AUCUN événement ne le signale. La
            reprise au premier plan relance déjà la vérification, ce bouton est
            le filet quand l'OS ne notifie rien du tout. */}
        <GhostBtn onClick={onRecheck}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
          {tr("J'ai activé, vérifier", "فعّلته، تحقّق")}
        </GhostBtn>

        <GhostBtn onClick={() => void handleLogout()}>
          {logoutPending && <Loader2 className="size-4 animate-spin" />}
          {tr("Se déconnecter", "تسجيل الخروج")}
        </GhostBtn>
        {/* Course en cours → le serveur REFUSE la déconnexion. Le message vit
            sous le bouton (règle projet : inline, jamais de toast). */}
        {logoutError && (
          <p
            className="text-body-sm mt-1.5 text-center font-semibold"
            style={{ color: RED }}
          >
            {logoutError}
          </p>
        )}
      </div>
    </div>
  );
}

function Reason({
  title,
  sub,
  last,
}: {
  title: string;
  sub: string;
  last?: boolean;
}) {
  return (
    <div
      className={
        last
          ? "flex gap-2.5"
          : "mb-2.5 flex gap-2.5 border-b border-[var(--d-line)] pb-2.5"
      }
    >
      <span
        className="mt-0.5 size-[7px] shrink-0 rounded-full"
        style={{ background: VIOLET }}
      />
      <span>
        <b className="text-body-sm block font-extrabold">{title}</b>
        <small className="text-caption text-[var(--d-muted)]">{sub}</small>
      </span>
    </div>
  );
}
