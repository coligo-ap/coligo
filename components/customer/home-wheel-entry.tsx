"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Gift, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  dismissWheelToday,
  isWheelDismissedToday,
} from "@/components/customer/wheel/wheel-dismiss";

/**
 * Entrée ROUE COLIGO sur l'accueil marketplace — bandeau ANIMÉ style Temu
 * (mini-roue qui tourne, éclat balayé, badge « 1 » pulsé quand le tour du
 * jour est disponible) : pousse à revenir chaque jour SANS nouveau vecteur
 * de fraude — pur lien vers /roue, tirage 100 % serveur (RPC wheel_spin,
 * un tour par jour, lots = bons d'achat contrôlés par le super-admin).
 *
 * Rendu UNIQUEMENT si client connecté ET flag « wheel » actif (décidé par la
 * page serveur). `my_wheel_state` est appelée côté client (jamais d'await
 * bloquant sur la page la plus fréquentée) — best-effort : sans réponse, le
 * bandeau reste avec le texte générique.
 */

/** null = état pas encore chargé (copy générique, jamais de fausse promesse). */
type WheelHomeState = { can_spin: boolean } | null;

const CSS = `
@keyframes hwSpin{to{transform:rotate(360deg)}}
@keyframes hwSheen{0%,72%{transform:translateX(-130%) skewX(-18deg)}100%{transform:translateX(230%) skewX(-18deg)}}
@keyframes hwPing{0%{box-shadow:0 0 0 0 rgba(255,255,255,.55)}80%,100%{box-shadow:0 0 0 9px rgba(255,255,255,0)}}
@keyframes hwBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes hwTwinkle{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}
@media (prefers-reduced-motion:reduce){.hw-anim,.hw-anim *{animation:none!important}}
`;

export function HomeWheelEntry() {
  const t = useTranslations("wheel");
  const [state, setState] = useState<WheelHomeState>(null);
  // Masquable, exactement comme la bulle : quelqu'un qui a déjà joué — ou que
  // ça n'intéresse pas — ne doit pas retrouver le bandeau à chaque écran.
  const [uid, setUid] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user.id ?? null;
      if (!alive) return;
      setUid(id);
      if (id && isWheelDismissedToday(id)) setClosed(true);
    });
    // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string
    ) => Promise<{ data: { can_spin?: boolean } | null }>;
    rpc("my_wheel_state")
      .then(({ data }) => {
        if (alive && data) setState({ can_spin: !!data.can_spin });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const canSpin = state?.can_spin ?? false;
  if (closed) return null;

  return (
    <Link
      href="/roue"
      prefetch
      className="hw-anim rounded-sheet-lg relative block overflow-hidden px-4 py-3 text-white"
      style={{
        backgroundImage:
          "linear-gradient(120deg,#6C2BD9 0%,#8A4DFF 55%,#FF2D7A 130%)",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {/* Fermer jusqu'à demain — au-dessus du lien, sans le déclencher. */}
      <button
        type="button"
        aria-label={t("bubbleClose")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dismissWheelToday(uid);
          setClosed(true);
        }}
        className="absolute end-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-full bg-black/20 text-white"
      >
        <X className="size-3" />
      </button>
      {/* Éclat balayé périodique (accroche l'œil sans agresser). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-1/3 bg-white/20 blur-md"
        style={{ animation: "hwSheen 3.4s ease-in-out infinite" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1.5 right-10"
        style={{ animation: "hwTwinkle 2.1s ease-in-out infinite" }}
      >
        <Sparkles className="size-3.5 text-white/80" />
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-1.5 left-1/2"
        style={{ animation: "hwTwinkle 2.7s ease-in-out .6s infinite" }}
      >
        <Sparkles className="size-3 text-white/60" />
      </span>

      <span className="relative z-10 flex items-center gap-3">
        {/* Mini-roue : disque conique qui tourne en continu + moyeu cadeau. */}
        <span className="relative grid size-12 shrink-0 place-items-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-white/70"
            style={{
              background:
                "conic-gradient(#FFD84D 0 45deg,#fff 45deg 90deg,#FF2D7A 90deg 135deg,#fff 135deg 180deg,#3DDC97 180deg 225deg,#fff 225deg 270deg,#FFD84D 270deg 315deg,#fff 315deg 360deg)",
              animation: "hwSpin 7s linear infinite",
            }}
          />
          <span className="relative grid size-6 place-items-center rounded-full bg-white text-[var(--color-primary-600)] shadow">
            <Gift
              className="size-3.5"
              style={{ animation: "hwBob 1.6s ease-in-out infinite" }}
            />
          </span>
          {canSpin && (
            <span
              className="text-nano absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-[#FFD84D] font-extrabold text-[#4C1B9B]"
              style={{ animation: "hwPing 1.6s ease-out infinite" }}
            >
              1
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <b className="text-body-xl block font-extrabold tracking-[-0.2px]">
            {t("homeTitle")}
          </b>
          <span className="text-label block truncate font-semibold text-white/85">
            {/* Déjà joué (état CONFIRMÉ) → « reviens demain », pas de fausse
                promesse de tour ; état inconnu → accroche générique. */}
            {canSpin
              ? t("homeSpinReady")
              : state
                ? t("homeComeBack")
                : t("homeTagline")}
          </span>
        </span>

        <span className="text-label-lg flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 font-extrabold text-[var(--color-primary-600)]">
          {t("homeCta")}
          <ChevronRight className="size-3.5 rtl:-scale-x-100" />
        </span>
      </span>
    </Link>
  );
}
