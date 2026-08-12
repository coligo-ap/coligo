"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CreditCard,
  HelpCircle,
  Loader2,
  Mail,
  MessageSquare,
  Package,
  Truck,
  UserRound,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  SUPPORT_OPEN_EVENT,
  supportMailto,
  tawkChatUrl,
  type OpenSupportOptions,
} from "./tawk-chat";

// =============================================================================
// SupportSheet — LA porte d'entrée du support, la même partout.
// =============================================================================
// Pourquoi une feuille MAISON plutôt que la fenêtre Tawk directement :
//
//  1. FIABILITÉ. Tawk est un tiers : réseau algérien capricieux, bloqueur de
//     pub, réseau d'entreprise, ou 403 Cloudflare — le script peut ne jamais
//     se charger. Avant, dans ce cas, le bouton « Contacter le support » ne
//     faisait RIEN : aucun retour, aucune alternative. Ici on ouvre TOUJOURS
//     quelque chose, et si le chat ne répond pas on bascule sur l'e-mail avec
//     tout le contexte — le client n'est jamais dans une impasse.
//  2. CONTEXTE. On rappelle la commande/course concernée AVANT d'écrire :
//     le client voit qu'on sait de quoi il parle.
//  3. QUALIFICATION. Le sujet choisi part en tag Tawk → l'agent sait de quoi
//     il s'agit avant le premier message, et la file se filtre.
//  4. La BARRE DE NAVIGATION reste visible : c'est une feuille ancrée en bas,
//     pas une fenêtre tierce qui recouvre tout l'écran.
//
// Montée une seule fois par espace, DANS <TawkChat> (déjà présent partout) —
// aucun montage supplémentaire à brancher.
// =============================================================================

type Topic = {
  key: string;
  label: string;
  icon: React.ReactNode;
};

export function SupportSheet() {
  const t = useTranslations("support");
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<OpenSupportOptions | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "opening" | "slow" | "failed">(
    "idle"
  );
  /** Le chat est-il affiché DANS la feuille (iframe) ? */
  const [chatting, setChatting] = useState(false);
  /** URL du chat FIGÉE à l'ouverture (cf. onChat) — l'iframe ne doit pas se
   *  recharger si l'état change, sinon la conversation en cours est perdue. */
  const [chatSrc, setChatSrc] = useState<string | null>(null);

  // Le chat tiers peut TARDER (Tawk froid, réseau algérien) ou ne jamais
  // répondre. Au-delà du délai on n'ARRÊTE PAS le chargement — tuer un chat
  // simplement lent, c'est couper le client juste avant que l'agent arrive :
  // on retire seulement le voile d'attente et on propose l'e-mail EN PLUS,
  // sous le cadre. Le chat peut donc encore s'afficher derrière.
  useEffect(() => {
    if (!chatting || phase !== "opening") return;
    const id = window.setTimeout(() => setPhase("slow"), 15_000);
    return () => window.clearTimeout(id);
  }, [chatting, phase]);

  // Toute l'app ouvre le support par cet ÉVÉNEMENT (openSupportChat) : les
  // dizaines de boutons existants n'ont pas eu à changer.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenSupportOptions>).detail ?? {};
      setOpts(detail);
      setTopic(detail.subject ?? null);
      setPhase("idle");
      setChatting(false);
      setChatSrc(null);
      setOpen(true);
    };
    window.addEventListener(SUPPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, onOpen);
  }, []);

  const topics: Topic[] = [
    {
      key: t("topicOrder"),
      label: t("topicOrder"),
      icon: <Package className="size-4" />,
    },
    {
      key: t("topicDelivery"),
      label: t("topicDelivery"),
      icon: <Truck className="size-4" />,
    },
    {
      key: t("topicPayment"),
      label: t("topicPayment"),
      icon: <CreditCard className="size-4" />,
    },
    {
      key: t("topicAccount"),
      label: t("topicAccount"),
      icon: <UserRound className="size-4" />,
    },
    {
      key: t("topicOther"),
      label: t("topicOther"),
      icon: <HelpCircle className="size-4" />,
    },
  ];

  /** Sujet effectif : celui choisi ici, sinon celui passé par l'écran appelant. */
  const effective = useCallback(
    (): OpenSupportOptions => ({
      ...(opts ?? {}),
      subject: topic ?? opts?.subject ?? null,
    }),
    [opts, topic]
  );

  /**
   * Chat en direct — ouvert DANS la feuille (iframe), jamais en plein écran :
   * l'app reste visible derrière et la barre du bas reste accessible. On borne
   * le chargement : si l'iframe ne répond pas, on le DIT et on propose
   * l'e-mail plutôt que de laisser tourner un cadre vide.
   */
  const onChat = useCallback(() => {
    const url = tawkChatUrl(effective());
    if (!url) {
      setPhase("failed");
      return;
    }
    // Figée à l'ouverture : sans ça, re-cliquer un sujet changerait l'URL et
    // rechargerait l'iframe — la conversation en cours serait perdue.
    setChatSrc(url);
    setPhase("opening");
    setChatting(true);
  }, [effective]);

  const onEmail = useCallback(() => {
    const href = supportMailto(effective());
    if (href) window.location.href = href;
  }, [effective]);

  const ref = opts?.orderRef ?? null;

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title={
        <span className="inline-flex items-center gap-2">
          <span className="bg-primary-50 text-primary-700 grid size-8 shrink-0 place-items-center rounded-lg">
            <MessageSquare className="size-4" />
          </span>
          {t("title")}
        </span>
      }
      description={ref ? t("contextOrder", { ref }) : t("subtitle")}
      // La BARRE DU BAS reste visible : la feuille s'arrête juste au-dessus
      // (54 px + zone sûre), au lieu de la recouvrir comme le faisait la
      // fenêtre Tawk qui prenait tout l'écran. Le client garde sa navigation
      // pendant qu'il demande de l'aide. Sur ordinateur (≥ sm) la feuille est
      // centrée et il n'y a pas de barre : on annule la marge.
      // MÊME LANGAGE que la carte « Commande envoyée » du paiement réussi :
      // une CARTE qui MONTE DU BAS (partner-sheet-in) avec le grand rayon
      // haut, pas une pop-up qui apparaît en fondu au milieu de l'écran.
      // Elle s'arrête juste au-dessus de la barre du bas, qui reste utilisable.
      className="partner-sheet-in rounded-t-panel-lg sm:rounded-panel-lg mb-[calc(54px+env(safe-area-inset-bottom))] sm:mb-0"
    >
      {/* ── CHAT INTÉGRÉ ──
          La conversation vit DANS la feuille, aux dimensions de l'app : pas de
          prise de contrôle plein écran, l'app reste visible derrière et la
          barre du bas reste accessible. */}
      {chatting && chatSrc && (
        <div className="rounded-card-lg border-border relative overflow-hidden border">
          {phase === "opening" && (
            <div className="bg-surface absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
              <Loader2 className="text-primary-600 size-6 animate-spin" />
              <p className="text-muted text-label-lg font-semibold">
                {t("opening")}
              </p>
            </div>
          )}
          <iframe
            src={chatSrc}
            title={t("chat")}
            onLoad={() => setPhase("idle")}
            className="block h-[58dvh] w-full border-0"
          />
        </div>
      )}

      {/* Le chat tarde → on ne le coupe pas, on offre juste une porte de
          sortie écrite. Le cadre continue de charger au-dessus. */}
      {chatting && phase === "slow" && (
        <button
          type="button"
          onClick={onEmail}
          className="border-border bg-surface hover:bg-surface-2 rounded-card-lg text-body-sm mt-2 flex w-full items-center justify-center gap-2 border px-4 py-2.5 font-bold transition-colors"
        >
          <Mail className="size-4" />
          {t("email")}
        </button>
      )}

      {/* Le menu disparaît pendant la conversation : un seul objet à l'écran. */}
      {chatting ? null : (
        <>
          {/* SUJET — qualifie la demande AVANT d'écrire : l'agent reçoit le tag,
          le client n'a pas à raconter deux fois son problème. */}
          <p className="text-muted text-caption mb-2 font-extrabold tracking-wide uppercase">
            {t("topicsTitle")}
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            {topics.map((x) => {
              const active = topic === x.key;
              return (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setTopic(active ? null : x.key)}
                  className={cn(
                    "rounded-control text-label-lg inline-flex items-center gap-1.5 border px-3 py-2 font-bold transition-colors",
                    active
                      ? "border-primary-600 bg-primary-50 text-primary-700"
                      : "border-border bg-surface text-foreground hover:bg-surface-2"
                  )}
                >
                  {x.icon}
                  {x.label}
                </button>
              );
            })}
          </div>

          {/* CHAT indisponible → message honnête + l'e-mail devient la voie
          principale. On n'invente pas un canal qui ne marche pas. */}
          {phase === "failed" && (
            <div className="border-warning-200 bg-warning-50 mb-3 rounded-lg border p-3">
              <p className="text-warning-800 text-body-sm flex items-center gap-1.5 font-extrabold">
                <AlertTriangle className="size-4 shrink-0" />
                {t("unavailable")}
              </p>
              <p className="text-warning-800/90 text-label mt-1 font-medium">
                {t("unavailableHint")}
              </p>
            </div>
          )}

          {/* CANAUX — le direct d'abord, l'écrit toujours disponible. */}
          <button
            type="button"
            onClick={onChat}
            disabled={phase === "opening"}
            className="bg-primary-600 hover:bg-primary-700 rounded-card-lg flex w-full items-center gap-3 px-4 py-3 text-start text-white transition-colors disabled:opacity-70"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/15">
              {phase === "opening" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MessageSquare className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <b className="text-body-lg block font-extrabold">
                {phase === "opening" ? t("opening") : t("chat")}
              </b>
              <small className="text-label block text-white/85">
                {t("chatHint")}
              </small>
            </span>
          </button>

          <button
            type="button"
            onClick={onEmail}
            className="border-border bg-surface hover:bg-surface-2 rounded-card-lg mt-2 flex w-full items-center gap-3 border px-4 py-3 text-start transition-colors"
          >
            <span className="bg-surface-2 text-foreground grid size-9 shrink-0 place-items-center rounded-lg">
              <Mail className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <b className="text-foreground text-body-lg block font-extrabold">
                {t("email")}
              </b>
              <small className="text-muted text-label block">
                {t("emailHint")}
              </small>
            </span>
          </button>
        </>
      )}
    </Sheet>
  );
}
