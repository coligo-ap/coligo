"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  dismissWheelToday,
  isWheelDismissedToday,
  readWheelStore,
  writeWheelStore,
} from "@/components/customer/wheel/wheel-dismiss";

// =============================================================================
// ROUE COLIGO — BULLE FLOTTANTE (façon bulle de discussion Messenger).
//
// Pourquoi une bulle : sur l'accueil, l'entrée de la roue et les bannières
// marketing se disputaient la même place, l'une poussant l'autre vers le bas.
// La bulle flotte AU-DESSUS du contenu : les bannières gardent leur espace, et
// la roue reste visible sans rien décaler.
//
// Règles produit (calquées sur ce que font Temu et Shein) :
//   • elle ne vit que sur l'accueil marketplace — nulle part ailleurs ;
//   • elle s'affiche 3 MINUTES puis s'efface d'elle-même : une invitation,
//     pas un élément permanent qui gêne ;
//   • on la DÉPLACE au doigt où on veut, et elle se colle au bord le plus
//     proche en se relâchant (comportement Messenger) ;
//   • on la CHASSE d'un glissement vers le bas, ou d'un tap sur la croix ;
//   • chassée, elle ne revient QUE LE LENDEMAIN, à la réouverture — quelqu'un
//     qui a déjà joué, ou que ça n'intéresse pas, doit être tranquille.
//
// Aucun tirage ici : la bulle n'est qu'un raccourci. Le tirage reste 100 %
// serveur (RPC wheel_spin, un tour par jour).
// =============================================================================

const SHOW_MS = 3 * 60 * 1000; // 3 minutes
const SIZE = 62;
const MARGIN = 14;

export function WheelBubble() {
  const t = useTranslations("wheel");
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [canSpin, setCanSpin] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  // ── Décision d'affichage : compte, jour, et état de la roue ──────────────
  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user.id ?? null;
      if (!alive) return;
      setUid(id);
      if (!id) return;
      const saved = readWheelStore()[id] ?? {};
      if (isWheelDismissedToday(id)) return; // écartée aujourd'hui
      const w = window.innerWidth;
      const h = window.innerHeight;
      setPos({
        x: saved.x ?? w - SIZE - MARGIN,
        y: saved.y ?? Math.round(h * 0.62),
      });
      // RPC hors types générés → bind OBLIGATOIRE.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string
      ) => Promise<{ data: { can_spin?: boolean } | null }>;
      rpc("my_wheel_state")
        .then(({ data: st }) => {
          if (!alive) return;
          setCanSpin(!!st?.can_spin);
          setVisible(true);
        })
        .catch(() => {
          if (alive) setVisible(true); // sans réponse : libellé générique
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  // ── Effacement automatique après 3 minutes ──────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => {
      setLeaving(true);
      window.setTimeout(() => setVisible(false), 260);
    }, SHOW_MS);
    return () => window.clearTimeout(id);
  }, [visible]);

  const dismiss = useCallback(
    (persist: boolean) => {
      setLeaving(true);
      window.setTimeout(() => setVisible(false), 260);
      if (persist) dismissWheelToday(uid);
    },
    [uid]
  );

  // ── Déplacement au doigt + accrochage au bord ───────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = {
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      moved: false,
    };
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const x = e.clientX - d.dx;
    const y = e.clientY - d.dy;
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1) d.moved = true;
    setPos({ x, y });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;

    // Simple tap (aucun déplacement) → on ouvre la roue.
    if (!d.moved) {
      router.push("/roue");
      return;
    }
    setPos((p) => {
      if (!p) return p;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Lâchée dans le BAS de l'écran → on la chasse (geste naturel « jeter »).
      if (p.y > h - 130) {
        dismiss(true);
        return p;
      }
      // Sinon : accrochage au bord le plus proche, comme une bulle Messenger.
      const snapX = p.x + SIZE / 2 < w / 2 ? MARGIN : w - SIZE - MARGIN;
      const y = Math.min(Math.max(p.y, 90), h - SIZE - 120);
      if (uid) {
        // La position choisie est mémorisée : la bulle réapparaîtra là où le
        // client l'a posée, pas à un endroit imposé.
        const s = readWheelStore();
        s[uid] = { ...(s[uid] ?? {}), x: snapX, y };
        writeWheelStore(s);
      }
      return { x: snapX, y };
    });
  };

  if (!visible || !pos) return null;

  return (
    <>
      <style>{`
@keyframes wbIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
@keyframes wbSpin{to{transform:rotate(360deg)}}
@keyframes wbPing{0%{box-shadow:0 0 0 0 rgba(255,45,122,.5)}80%,100%{box-shadow:0 0 0 12px rgba(255,45,122,0)}}
@media (prefers-reduced-motion:reduce){.wb,.wb *{animation:none!important}}
`}</style>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={t("bubbleAria")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") router.push("/roue");
        }}
        className="wb fixed z-[70] touch-none select-none"
        style={{
          left: pos.x,
          top: pos.y,
          width: SIZE,
          height: SIZE,
          transition: dragging
            ? "none"
            : "left .22s cubic-bezier(.22,1,.36,1), top .22s cubic-bezier(.22,1,.36,1), opacity .26s, transform .26s",
          opacity: leaving ? 0 : 1,
          transform: leaving ? "scale(.5)" : undefined,
          animation: dragging
            ? undefined
            : "wbIn .32s cubic-bezier(.22,1,.36,1)",
          cursor: dragging ? "grabbing" : "grab",
        }}
      >
        <div
          className="relative grid size-full place-items-center rounded-full"
          style={{
            background: "linear-gradient(135deg,#6C2BD9,#4B1FA6)",
            animation: canSpin ? "wbPing 2.4s ease-out infinite" : undefined,
          }}
        >
          {/* Mini-roue : 6 quartiers, elle tourne doucement. */}
          <span
            aria-hidden
            className="block rounded-full"
            style={{
              width: 34,
              height: 34,
              background:
                "conic-gradient(#fff 0 60deg,#FF2D7A 60deg 120deg,#fff 120deg 180deg,#FFD166 180deg 240deg,#fff 240deg 300deg,#8A4DFF 300deg 360deg)",
              animation: "wbSpin 7s linear infinite",
              boxShadow: "inset 0 0 0 3px rgba(255,255,255,.9)",
            }}
          />
          {canSpin && (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 grid size-[19px] place-items-center rounded-full text-[10px] font-black text-white"
              style={{ background: "#FF2D7A" }}
            >
              1
            </span>
          )}
        </div>

        {/* Croix : chasser sans avoir à faire glisser. */}
        <button
          type="button"
          aria-label={t("bubbleClose")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            dismiss(true);
          }}
          className="absolute -top-2 -left-2 grid size-[22px] place-items-center rounded-full border border-black/10 bg-white text-[#6d6880]"
        >
          <X className="size-3" />
        </button>
      </div>
    </>
  );
}
