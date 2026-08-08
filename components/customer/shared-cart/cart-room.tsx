"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Hourglass,
  Loader2,
  Lock,
  LockOpen,
  MessageCircle,
  Minus,
  PackageCheck,
  Plus,
  ShoppingBag,
  Store,
  Trash2,
  Truck,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { sharedCartChannel } from "@/lib/realtime/broadcast";
import { useBroadcastBump } from "@/lib/realtime/use-broadcast-bump";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { PaidCelebrationSheet } from "@/components/customer/shared-cart/paid-celebration-sheet";
import { useConfirm } from "@/components/ui/confirm";
import { GuestHeader } from "@/components/customer/shared-cart/guest-header";
import { AvatarDot } from "@/components/ui/avatar-dot";
import { setLocale } from "@/i18n/actions";
import { addItem, clearMerchantCart } from "@/lib/customer/cart-store";
import {
  guestJoin,
  guestOrderAndPay,
  guestSetQty,
  revokeGuestMember,
} from "@/app/p/[token]/actions";
import {
  attachOrderToSharedCart,
  cancelCart,
  captainRemoveItem,
  getCartForCheckout,
  getMyDeliveryAddresses,
  lockCart,
  setInvitationsClosed,
  setSharedCartDelivery,
  unlockCart,
} from "@/app/(customer)/panier-partage/actions";

// =============================================================================
// CartRoom — la « pièce » du panier partagé (/p/[token]), UNE SEULE room pour
// le capitaine ET les invités (contrôles conditionnels). Temps réel : bump
// broadcast + poll 6 s filet + resync à la reprise (règle arrière-plan).
// =============================================================================

type SCMember = {
  id: string;
  kind: "captain" | "guest";
  display_name: string | null;
  member_number: number;
  color_index: number;
};
type SCOption = {
  option_id: string;
  group_fr: string;
  group_ar: string | null;
  name_fr: string;
  name_ar: string | null;
  delta_da: number;
};
type SCItem = {
  id: string;
  member_id: string;
  product_id: string;
  name_fr: string;
  name_ar: string | null;
  image_url: string | null;
  unit: string | null;
  min_qty: number | null;
  max_qty: number | null;
  quantity: number;
  unit_price_da: number;
  line_total_da: number;
  available: boolean;
  options: SCOption[];
};
export type SharedCartView = {
  cart: {
    id: string;
    status: "open" | "locked" | "ordered" | "expired" | "cancelled";
    invitations_closed: boolean;
    expires_at: string;
    ordered: boolean;
    has_payment_link: boolean;
    /** uuid de la commande liée (mig 0411) — la fiche reste gardée par RLS. */
    order_id: string | null;
    payment_method: string | null;
    payment_status: string | null;
    /** Récupération fixée par le PROPRIÉTAIRE (mig 0423). */
    fulfillment_type: "pickup" | "delivery";
    delivery_mode: "express" | null;
    delivery_address_text: string | null;
  };
  captain_name: string | null;
  merchant: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    category: string | null;
    min_order_da: number | null;
  } | null;
  members: SCMember[];
  items: SCItem[];
  total_da: number;
};

/** Identité invité persistée par panier (uuid généré côté navigateur). */
type GuestIdentity = { id: string; joined: boolean };
function guestStorageKey(token: string) {
  return `coligo:guest:${token}`;
}
function readGuest(token: string): GuestIdentity {
  try {
    const raw = window.localStorage.getItem(guestStorageKey(token));
    if (raw) return JSON.parse(raw) as GuestIdentity;
  } catch {
    /* stockage indisponible */
  }
  const fresh = { id: crypto.randomUUID(), joined: false };
  try {
    window.localStorage.setItem(guestStorageKey(token), JSON.stringify(fresh));
  } catch {
    /* mode privé strict : identité éphémère */
  }
  return fresh;
}
function saveGuest(token: string, g: GuestIdentity) {
  try {
    window.localStorage.setItem(guestStorageKey(token), JSON.stringify(g));
  } catch {
    /* sans gravité */
  }
}

export function CartRoom({
  token,
  isCaptain,
  appUrl,
  showChrome = false,
}: {
  token: string;
  isCaptain: boolean;
  appUrl: string;
  /** CLIENT connecté : bouton retour + la nav basse est rendue par la page. */
  showChrome?: boolean;
}) {
  const t = useTranslations("sharedCart");
  const locale = useLocale();
  const router = useRouter();
  const confirm = useConfirm();

  const [view, setView] = useState<SharedCartView | null | "notfound">(null);
  const [guest, setGuest] = useState<GuestIdentity | null>(null);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Info NON bloquante (ex : « le capitaine a été prévenu ») — inline.
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Sections par participant OUVRANTES/FERMANTES — tout ouvert par défaut,
  // l'en-tête (compte + sous-total) reste parlant une fois replié.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [resyncNonce, setResyncNonce] = useState(0);
  const seenItems = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  // Pop-up « Commande payée » : déclenchée sur la TRANSITION impayé→payé vue
  // en direct (bump du webhook, poll filet) — montrée UNE fois (anti-flash).
  // `undefined` = rien observé encore (revisite d'une room déjà payée ⇒ pas
  // de pop-up) ; `null` = observé SANS commande — le wallet intégral du
  // capitaine attache une commande déjà payée sans passer par 'pending',
  // la transition null→paid compte donc aussi.
  const prevPayStatus = useRef<string | null | undefined>(undefined);
  const [paidPopup, setPaidPopup] = useState(false);

  // Ordonnancement des réponses : une réponse PÉRIMÉE (poll parti avant le
  // paiement, arrivé après le bump) ne doit pas écraser un état plus récent —
  // sinon le bandeau « payée » re-flashe le CTA payer et le détecteur de
  // transition se réarme (pop-up rejouée après fermeture).
  const fetchSeq = useRef(0);
  const fetchApplied = useRef(0);

  // ── Lecture (RPC anon token-validée — la même pour capitaine et invités) ──
  const fetchView = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const supabase = createClient();
      // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: SharedCartView | null }>;
      const { data } = await rpc("shared_cart_by_token", { p_token: token });
      if (seq < fetchApplied.current) return; // réponse périmée
      fetchApplied.current = seq;
      if (!data) {
        setView("notfound");
        return;
      }
      // Micro-animation : marquer les lignes jamais vues (sauf 1er chargement).
      if (seenItems.current.size > 0) {
        const fresh = new Set<string>();
        for (const it of data.items)
          if (!seenItems.current.has(it.id)) fresh.add(it.id);
        if (fresh.size > 0) setFreshIds(fresh);
      }
      seenItems.current = new Set(data.items.map((i) => i.id));
      setView(data);
    } catch {
      /* réseau : le poll suivant réessaie */
    }
  }, [token]);

  // Identité invité + éventuel re-join silencieux (récupère member_id).
  useEffect(() => {
    if (isCaptain) return;
    const g = readGuest(token);
    setGuest(g);
    if (g.joined) {
      void guestJoin({ token, guestToken: g.id }).then((r) => {
        if (r.ok && r.member) setMyMemberId(r.member.id);
      });
    }
  }, [token, isCaptain]);

  // Fetch initial + poll filet + reprise. Temps réel (bump public) : topic
  // serveur FIXE partagé avec /payer ⇒ abonnement anti-collision
  // (reference_realtime_channel_topic_collision).
  useEffect(() => {
    void fetchView();
    const poll = setInterval(() => void fetchView(), 6000);
    return () => clearInterval(poll);
  }, [fetchView, resyncNonce]);
  useBroadcastBump(
    sharedCartChannel(token),
    "bump",
    () => void fetchView(),
    resyncNonce
  );
  useResumeResync(() => setResyncNonce((n) => n + 1));

  // Capitaine : son member_id vient de la vue.
  useEffect(() => {
    if (isCaptain && view && view !== "notfound") {
      const cap = view.members.find((m) => m.kind === "captain");
      if (cap) setMyMemberId(cap.id);
    }
  }, [isCaptain, view]);

  // Paiement CONFIRMÉ pendant qu'on regarde la room → pop-up célébration
  // (même sync bump + poll : la transition est détectée quel que soit le canal).
  useEffect(() => {
    if (!view || view === "notfound") return;
    const st = view.cart.payment_status;
    if (
      (prevPayStatus.current === "pending" || prevPayStatus.current === null) &&
      st === "paid" &&
      view.cart.payment_method === "online"
    ) {
      setPaidPopup(true);
    }
    prevPayStatus.current = st;
  }, [view]);

  // Invité pas encore membre → feuille de bienvenue (panier encore ouvert).
  useEffect(() => {
    if (isCaptain || !guest || guest.joined) return;
    if (view && view !== "notfound" && view.cart.status === "open") {
      setJoinOpen(true);
    }
  }, [isCaptain, guest, view]);

  if (view === null) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="bg-surface-3 h-24 animate-pulse rounded-xl" />
        <div className="bg-surface-3 mt-3 h-64 animate-pulse rounded-xl" />
      </div>
    );
  }
  if (view === "notfound") {
    return (
      <div className="mx-auto grid min-h-dvh max-w-lg place-items-center px-6 text-center">
        <div>
          <span className="bg-surface-2 text-subtle mx-auto grid size-14 place-items-center rounded-2xl">
            <ShoppingBag className="size-7" />
          </span>
          <p className="text-foreground mt-3 text-lg font-extrabold">
            {t("notFoundTitle")}
          </p>
          <p className="text-muted mt-1 text-sm">{t("notFoundDesc")}</p>
        </div>
      </div>
    );
  }

  const { cart, merchant, members, items, total_da } = view;
  const ar = locale === "ar";
  const open = cart.status === "open";
  const joinedOrCaptain = isCaptain || (guest?.joined ?? false);
  const memberName = (m: SCMember) =>
    m.display_name ??
    (m.kind === "captain"
      ? (view.captain_name ?? t("captain"))
      : t("guestN", { n: m.member_number }));
  const link = `${appUrl.replace(/\/+$/, "")}/p/${token}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(
    t("waInvite", { merchant: merchant?.name ?? "Coligo", link })
  )}`;

  // MA section EN PREMIER (mes steppers sous la main), puis le capitaine,
  // puis les autres par ordre d'arrivée — chacun retrouve ses articles sans
  // scroller (facilite la tâche des invités).
  const memberRank = (m: SCMember) =>
    m.id === myMemberId ? 0 : m.kind === "captain" ? 1 : 2;
  const itemsByMember = members
    .map((m) => ({
      member: m,
      items: items.filter((i) => i.member_id === m.id),
    }))
    .filter((g) => g.items.length > 0)
    .sort(
      (a, b) =>
        memberRank(a.member) - memberRank(b.member) ||
        a.member.member_number - b.member.member_number
    );

  const doJoin = async (skip: boolean) => {
    if (!guest) return;
    setJoinBusy(true);
    const res = await guestJoin({
      token,
      guestToken: guest.id,
      name: skip ? null : joinName.trim() || null,
    });
    setJoinBusy(false);
    if (res.ok && res.member) {
      const next = { ...guest, joined: true };
      saveGuest(token, next);
      setGuest(next);
      setMyMemberId(res.member.id);
      setJoinOpen(false);
      void fetchView();
    }
  };

  const run = async (
    key: string,
    fn: () => Promise<{ ok: boolean; error?: string }>
  ) => {
    setActionError(null);
    setActionBusy(key);
    const res = await fn();
    setActionBusy(null);
    if (!res.ok) setActionError(res.error ?? t("actionError"));
    void fetchView();
    return res.ok;
  };

  // ── Commander (capitaine) : lock → hydrate panier local → checkout ──
  const order = async () => {
    setActionError(null);
    setActionBusy("order");
    try {
      if (cart.status === "open") {
        const locked = await lockCart(cart.id);
        if (!locked.ok) {
          setActionError(locked.error);
          return;
        }
      }
      const res = await getCartForCheckout(cart.id);
      if (!res.ok) {
        setActionError(res.error);
        return;
      }
      if (res.items.length === 0) {
        setActionError(t("emptyOrderError"));
        return;
      }
      if (res.skipped > 0) {
        const go = await confirm({
          title: t("skippedTitle"),
          message: t("skippedBody", { count: res.skipped }),
          confirmLabel: t("skippedConfirm"),
        });
        if (!go) {
          setActionBusy(null);
          return;
        }
      }
      clearMerchantCart(res.merchant.id);
      for (const it of res.items) {
        addItem(
          {
            id: res.merchant.id,
            slug: res.merchant.slug,
            name: res.merchant.name,
            logo_url: res.merchant.logo_url,
          },
          {
            product_id: it.product_id,
            name: it.name,
            name_ar: it.name_ar,
            unit_price_da: it.unit_price_da,
            quantity: it.quantity,
            unit: it.unit,
            min_qty: it.min_qty,
            max_qty: it.max_qty,
            image_url: it.image_url,
            options: it.options,
          }
        );
      }
      router.push(`/checkout?shared=${cart.id}`);
    } finally {
      setActionBusy(null);
    }
  };

  // Commande liée en attente de paiement EN LIGNE → le groupe peut payer.
  const canPayNow =
    cart.ordered &&
    cart.payment_method === "online" &&
    cart.payment_status !== "paid" &&
    cart.payment_status !== "refunded";

  // Ouvre la page de paiement du GROUPE (get-or-create du lien, RPC anon).
  const payNow = async (skipBusy = false): Promise<boolean> => {
    if (!skipBusy) {
      setActionError(null);
      setActionBusy("roompay");
    }
    try {
      const supabase = createClient();
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{
        data: { ok: boolean; reason?: string; ptoken?: string } | null;
      }>;
      const { data } = await rpc("shared_cart_room_pay_token", {
        p_token: token,
      });
      if (data?.ok && data.ptoken) {
        router.push(`/payer/${data.ptoken}`);
        return true;
      }
      if (data?.reason === "already_paid") {
        void fetchView();
        return true;
      }
      return false;
    } finally {
      if (!skipBusy) setActionBusy(null);
    }
  };

  // « Payer » du panier OUVERT — LE PREMIER QUI PAIE, PAIE :
  //   capitaine → checkout (il garde le choix cash/livraison) ;
  //   invité → la COMMANDE est créée directement (compte du capitaine,
  //   retrait, en ligne — mêmes règles d'argent que le checkout) puis la
  //   page de paiement s'ouvre. Peu importe qui paie.
  const payFromOpen = async () => {
    if (isCaptain) {
      await order();
      return;
    }
    setActionError(null);
    setNotice(null);
    setActionBusy("paybtn");
    try {
      if (await payNow(true)) return; // une commande existait déjà
      const res = await guestOrderAndPay({
        token,
        // Le capitaine est identifié par sa session ; l'invité par son jeton.
        guestToken: isCaptain ? null : (guest?.id ?? null),
      });
      if (res.ok) {
        router.push(`/payer/${res.ptoken}`);
        return;
      }
      if (res.reason === "already_paid") {
        void fetchView();
        return;
      }
      setActionError(res.message);
    } finally {
      setActionBusy(null);
    }
  };

  const stepFor = (it: SCItem) =>
    it.unit && it.unit !== "piece" && !Number.isInteger(it.quantity) ? 0.5 : 1;

  return (
    <div
      className={cn("bg-surface-2 min-h-dvh", showChrome ? "pb-56" : "pb-40")}
    >
      {/* Micro-animation d'apparition des ajouts temps réel. */}
      <style>{`@keyframes scAdd{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}`}</style>

      {/* Invité SANS compte : pas de coque client ni de barre du bas — cette
          barre de marque est son seul repère et reste visible au défilement.
          Le client connecté a déjà sa coque, on ne la double pas. */}
      {!showChrome && <GuestHeader tone="onColor" />}

      {/* ── EN-TÊTE ── */}
      <header
        className={cn(
          "from-primary-500 via-primary-600 to-primary-800 bg-gradient-to-br px-4 pb-12 text-white",
          // La zone sûre du haut est portée par la barre de marque quand elle
          // est là (sinon l'en-tête la porte lui-même).
          showChrome ? "pt-[calc(env(safe-area-inset-top)+1rem)]" : "pt-4"
        )}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {showChrome && (
            <button
              type="button"
              aria-label={t("backToCart")}
              onClick={() => router.push(isCaptain ? "/cart" : "/")}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
            >
              <ArrowLeft className="size-4.5 rtl:-scale-x-100" />
            </button>
          )}
          {merchant?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={merchant.logo_url}
              alt=""
              className="rounded-card size-11 shrink-0 bg-white object-cover"
            />
          ) : (
            <span className="rounded-card grid size-11 shrink-0 place-items-center bg-white/15">
              <ShoppingBag className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base leading-tight font-extrabold">
              {merchant?.name}
            </p>
            <p className="text-label font-semibold text-white/80">
              {t("cartOf", { name: view.captain_name ?? t("captain") })}
            </p>
          </div>
          {/* Langues (comme le sélecteur client existant) : FR / AR / EN. */}
          <div className="text-caption flex shrink-0 gap-0.5 rounded-full bg-white/15 p-0.5 font-extrabold">
            {(
              [
                ["fr", "FR"],
                ["ar", "ع"],
                ["en", "EN"],
              ] as const
            ).map(([l, label]) => (
              <button
                key={l}
                type="button"
                onClick={() => {
                  void setLocale(l).then(() => router.refresh());
                }}
                className={cn(
                  "rounded-full px-2 py-1 transition-colors",
                  locale === l ? "text-primary-700 bg-white" : "text-white/85"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Participants */}
        <div className="mx-auto mt-3 flex max-w-lg items-center gap-2">
          <div className="flex -space-x-1.5 rtl:space-x-reverse">
            {members.slice(0, 5).map((m) => (
              <AvatarDot
                key={m.id}
                name={memberName(m)}
                colorIndex={m.color_index}
                size="sm"
                className="ring-primary-600 ring-2"
              />
            ))}
          </div>
          <p className="text-label font-bold text-white/90">
            {t("participants", { count: members.length })}
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-6 max-w-lg space-y-3 px-4">
        {/* ── BANDEAUX D'ÉTAT ── */}
        {cart.status === "locked" && !cart.ordered && (
          <Banner icon={Lock} tone="amber">
            {t("lockedBanner", {
              name: view.captain_name ?? t("captain"),
            })}
          </Banner>
        )}
        {canPayNow ? (
          /* Info seulement — le bouton « Payer la commande » vit dans la
             barre du bas (jamais de doublon d'action). */
          <Banner icon={Lock} tone="amber">
            {t("roomPayTitle")} — {t("roomPayDesc")}
          </Banner>
        ) : cart.ordered && cart.payment_status === "refunded" ? (
          /* Annulée APRÈS paiement (le cron 0406 garde la commande attachée) :
             ne jamais affirmer « payée » — bandeau neutre dédié. */
          <Banner icon={X} tone="muted">
            {t("roomRefundedBanner")}
            {isCaptain && (
              <Link
                href={
                  cart.order_id ? `/commandes/${cart.order_id}` : "/commandes"
                }
                className="ms-1 font-extrabold underline underline-offset-2"
              >
                {t("seeOrder")}
              </Link>
            )}
          </Banner>
        ) : (
          cart.ordered && (
            <Banner icon={PackageCheck} tone="success">
              {cart.payment_status === "paid"
                ? t("roomPaidBanner")
                : t("orderedBanner")}
              {isCaptain && (
                <Link
                  href={
                    cart.order_id ? `/commandes/${cart.order_id}` : "/commandes"
                  }
                  className="ms-1 font-extrabold underline underline-offset-2"
                >
                  {t("seeOrder")}
                </Link>
              )}
            </Banner>
          )
        )}
        {cart.status === "expired" && (
          <Banner icon={Hourglass} tone="muted">
            {t("expiredBanner")}
          </Banner>
        )}
        {cart.status === "cancelled" && (
          <Banner icon={X} tone="muted">
            {t("cancelledBanner", {
              name: view.captain_name ?? t("captain"),
            })}
          </Banner>
        )}
        {open && cart.invitations_closed && (
          <Banner icon={UserX} tone="muted">
            {t("invitesClosedBanner")}
          </Banner>
        )}

        {/* ── RÉCUPÉRATION (mig 0423) : fixée par le PROPRIÉTAIRE, visible
            par TOUS avant de payer — retrait ou livraison express + adresse.
            La tournée reste réservée au checkout classique. ── */}
        {!cart.ordered && (
          <RecoveryCard
            cart={cart}
            merchantId={view.merchant?.id ?? null}
            isCaptain={isCaptain}
            captainName={view.captain_name ?? t("captain")}
            onSaved={() => void fetchView()}
          />
        )}

        {/* ── CONTRÔLES CAPITAINE ── */}
        {isCaptain && (open || (cart.status === "locked" && !cart.ordered)) && (
          /* Rangée d'actions DÉFILANTE (style Bolt) : une seule ligne compacte,
             le panier reste visible sans pavé de boutons. */
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
            {open && (
              <>
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-primary-600 hover:bg-primary-700 inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold whitespace-nowrap text-white transition-colors"
                >
                  <MessageCircle className="size-3.5" />
                  {t("inviteCta")}
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    } catch {
                      /* clipboard indisponible */
                    }
                  }}
                  className="bg-surface text-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold whitespace-nowrap"
                >
                  {copied ? (
                    <Check className="text-success-600 size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copied ? t("copied") : t("copyLink")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void run("invites", () =>
                      setInvitationsClosed(cart.id, !cart.invitations_closed)
                    )
                  }
                  disabled={actionBusy === "invites"}
                  className="bg-surface text-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold whitespace-nowrap disabled:opacity-60"
                >
                  {actionBusy === "invites" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : cart.invitations_closed ? (
                    <UserPlus className="size-3.5" />
                  ) : (
                    <UserX className="size-3.5" />
                  )}
                  {cart.invitations_closed
                    ? t("reopenInvites")
                    : t("closeInvites")}
                </button>
                <button
                  type="button"
                  onClick={() => void run("lock", () => lockCart(cart.id))}
                  disabled={actionBusy === "lock"}
                  className="bg-surface text-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold whitespace-nowrap disabled:opacity-60"
                >
                  {actionBusy === "lock" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Lock className="size-3.5" />
                  )}
                  {t("lockCta")}
                </button>
              </>
            )}
            {cart.status === "locked" && !cart.ordered && (
              <button
                type="button"
                onClick={() => void run("unlock", () => unlockCart(cart.id))}
                disabled={actionBusy === "unlock"}
                className="bg-surface text-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold whitespace-nowrap disabled:opacity-60"
              >
                {actionBusy === "unlock" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <LockOpen className="size-3.5" />
                )}
                {t("unlockCta")}
              </button>
            )}
            {!cart.ordered && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm({
                    title: t("cancelTitle"),
                    message: t("cancelBody"),
                    confirmLabel: t("cancelConfirm"),
                    danger: true,
                  });
                  if (ok) void run("cancel", () => cancelCart(cart.id));
                }}
                disabled={actionBusy === "cancel"}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-50 px-3 py-2 text-xs font-extrabold whitespace-nowrap text-rose-700 disabled:opacity-60"
              >
                {actionBusy === "cancel" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {t("cancelCta")}
              </button>
            )}
          </div>
        )}

        {actionError && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
            {actionError}
          </p>
        )}
        {notice && (
          <p className="border-success-200 bg-success-50 text-success-800 rounded-md border px-3 py-2 text-sm font-medium">
            {notice}
          </p>
        )}

        {/* ── ARTICLES PAR PARTICIPANT ── */}
        {itemsByMember.length === 0 ? (
          <div className="bg-surface shadow-float rounded-xl p-6 text-center">
            <span className="bg-primary-50 text-primary-600 mx-auto grid size-12 place-items-center rounded-2xl">
              <ShoppingBag className="size-6" />
            </span>
            <p className="text-foreground mt-2 text-base font-extrabold">
              {t("emptyTitle")}
            </p>
            <p className="text-muted mt-1 text-sm">{t("emptyDesc")}</p>
          </div>
        ) : (
          itemsByMember.map(({ member, items: mItems }) => (
            <section
              key={member.id}
              className="bg-surface rounded-sheet-lg shadow-float overflow-hidden"
            >
              {/* En-tête OUVRANT/FERMANT : compte + sous-total toujours lisibles. */}
              <button
                type="button"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(member.id)) next.delete(member.id);
                    else next.add(member.id);
                    return next;
                  })
                }
                className="flex w-full items-center gap-2 px-3.5 py-3 text-start"
              >
                <AvatarDot
                  name={memberName(member)}
                  colorIndex={member.color_index}
                  size="sm"
                />
                <p className="text-foreground text-body-sm min-w-0 flex-1 truncate font-extrabold">
                  {t("addedBy", { name: memberName(member) })}
                </p>
                {member.id === myMemberId && (
                  <span className="bg-primary-50 text-primary-700 text-micro shrink-0 rounded-full px-2 py-0.5 font-extrabold">
                    {t("you")}
                  </span>
                )}
                <span className="text-muted text-caption shrink-0 font-bold tabular-nums">
                  {mItems.length} ·{" "}
                  {formatDA(mItems.reduce((s, i) => s + i.line_total_da, 0))}
                </span>
                <ChevronDown
                  className={cn(
                    "text-subtle size-4 shrink-0 transition-transform",
                    collapsed.has(member.id) && "-rotate-90 rtl:rotate-90"
                  )}
                />
              </button>
              {/* RÉVOCATION (mig 0426) : le propriétaire retire un invité —
                  son identité est invalidée immédiatement côté serveur. */}
              {isCaptain && member.kind === "guest" && !cart.ordered && (
                <div className="flex justify-end px-3 pb-1">
                  <button
                    type="button"
                    disabled={actionBusy === `revoke:${member.id}`}
                    onClick={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: t("revokeTitle"),
                          message: t("revokeBody", {
                            name: memberName(member),
                          }),
                          confirmLabel: t("revokeCta"),
                          danger: true,
                        });
                        if (!ok) return;
                        setActionBusy(`revoke:${member.id}`);
                        const res = await revokeGuestMember({
                          cartId: cart.id,
                          memberId: member.id,
                          token,
                        });
                        setActionBusy(null);
                        if (res.ok) void fetchView();
                        else setActionError(t("revokeFailed"));
                      })();
                    }}
                    className="text-subtle hover:text-danger-600 text-caption inline-flex items-center gap-1 font-bold disabled:opacity-50"
                  >
                    {actionBusy === `revoke:${member.id}` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <UserX className="size-3" />
                    )}
                    {t("revokeCta")}
                  </button>
                </div>
              )}
              <ul
                className={cn(
                  "divide-border divide-y",
                  collapsed.has(member.id) && "hidden"
                )}
              >
                {mItems.map((it) => (
                  <li
                    key={it.id}
                    style={
                      freshIds.has(it.id)
                        ? { animation: "scAdd .35s ease-out" }
                        : undefined
                    }
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-2.5",
                      !it.available && "opacity-50"
                    )}
                  >
                    {it.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.image_url}
                        alt=""
                        className="bg-surface-2 rounded-control size-11 shrink-0 object-cover"
                      />
                    ) : (
                      <span className="bg-surface-2 text-subtle rounded-control grid size-11 shrink-0 place-items-center">
                        <ShoppingBag className="size-4.5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-bold">
                        {ar && it.name_ar ? it.name_ar : it.name_fr}
                      </p>
                      {it.options.length > 0 && (
                        <p className="text-muted text-caption truncate">
                          {it.options
                            .map((o) =>
                              ar && o.name_ar ? o.name_ar : o.name_fr
                            )
                            .join(" · ")}
                        </p>
                      )}
                      <p className="text-muted text-caption font-semibold">
                        {formatDA(it.unit_price_da)}
                        {it.unit ? ` / ${it.unit}` : ""}
                        {!it.available && ` — ${t("unavailable")}`}
                      </p>
                    </div>

                    {/* Stepper : SES lignes, panier ouvert. */}
                    {open && member.id === myMemberId ? (
                      <div className="bg-surface-2 flex shrink-0 items-center gap-1 rounded-full p-1">
                        <button
                          type="button"
                          aria-label="−"
                          onClick={() =>
                            void guestSetQty({
                              token,
                              guestToken: isCaptain
                                ? null
                                : (guest?.id ?? null),
                              itemId: it.id,
                              quantity: it.quantity - stepFor(it),
                            }).then(() => fetchView())
                          }
                          className="bg-surface grid size-7 place-items-center rounded-full active:scale-95"
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="text-foreground min-w-6 text-center text-sm font-extrabold tabular-nums">
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="+"
                          onClick={() =>
                            void guestSetQty({
                              token,
                              guestToken: isCaptain
                                ? null
                                : (guest?.id ?? null),
                              itemId: it.id,
                              quantity: it.quantity + stepFor(it),
                            }).then(() => fetchView())
                          }
                          className="bg-surface grid size-7 place-items-center rounded-full active:scale-95"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-muted shrink-0 text-sm font-bold tabular-nums">
                        ×{it.quantity}
                      </span>
                    )}

                    <span className="text-foreground w-16 shrink-0 text-end text-sm font-black tabular-nums">
                      {formatDA(it.line_total_da)}
                    </span>

                    {/* Capitaine : retirer N'IMPORTE quelle ligne. */}
                    {isCaptain && open && (
                      <button
                        type="button"
                        aria-label={t("removeItem")}
                        onClick={() =>
                          void run(`rm-${it.id}`, () =>
                            captainRemoveItem(cart.id, it.id)
                          )
                        }
                        disabled={actionBusy === `rm-${it.id}`}
                        className="text-subtle grid size-7 shrink-0 place-items-center rounded-full transition-colors hover:text-rose-600 disabled:opacity-50"
                      >
                        {actionBusy === `rm-${it.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <X className="size-4" />
                        )}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      {/* ── BARRE BASSE : total + CTA — au-dessus de la nav client si coque ── */}
      <div
        className={cn(
          "border-border bg-surface fixed inset-x-0 z-40 border-t px-4 pt-3",
          showChrome
            ? "bottom-[calc(env(safe-area-inset-bottom)+3.4rem)] pb-3 lg:bottom-0 lg:pb-[calc(env(safe-area-inset-bottom)+0.9rem)]"
            : "bottom-0 pb-[calc(env(safe-area-inset-bottom)+0.9rem)]"
        )}
      >
        <div className="mx-auto max-w-lg">
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-muted text-xs font-bold">
              {t("total")}
              {items.length > 0 && (
                <span className="text-subtle font-semibold">
                  {" "}
                  · {t("itemsCount", { count: items.length })}
                </span>
              )}
            </span>
            <span className="text-foreground text-lg font-black tabular-nums">
              {formatDA(total_da)}
            </span>
          </div>
          {/* Transparence : frais de service (+ livraison si le propriétaire
              l'a choisie) s'ajoutent — le payeur voit le détail sur /payer. */}
          <p className="text-subtle text-caption mt-0.5 font-semibold">
            {t("roomFeesNote")}
          </p>
          {/* Progression vers le minimum de commande (style Bolt) : le groupe
              voit d'un coup d'œil combien il reste à ajouter — et la barre
              avance en DIRECT avec les ajouts de chacun. */}
          {merchant?.min_order_da != null &&
            merchant.min_order_da > 0 &&
            open &&
            (total_da < merchant.min_order_da ? (
              <div className="mb-2">
                <div className="text-caption flex items-baseline justify-between gap-2 font-semibold">
                  <span className="text-muted">
                    {t("minOrderLeft", {
                      amount: formatDA(merchant.min_order_da - total_da),
                    })}
                  </span>
                  <span className="text-subtle shrink-0 tabular-nums">
                    {formatDA(merchant.min_order_da)}
                  </span>
                </div>
                <div className="bg-surface-3 mt-1 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-primary-500 h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((total_da / merchant.min_order_da) * 100)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ) : total_da > 0 ? (
              <p className="text-success-700 text-caption mb-2 inline-flex items-center gap-1 font-bold">
                <Check className="size-3.5" />
                {t("minOrderReached")}
              </p>
            ) : null)}
          {/* DEUX boutons, même design, couleurs différentes :
              « Ajouter des produits » (violet contour) + « Payer » (rose). */}
          <div className="flex gap-2">
            {open && (
              <>
                <Link
                  href={joinedOrCaptain ? `/p/${token}/catalogue` : "#"}
                  onClick={(e) => {
                    if (!joinedOrCaptain) {
                      e.preventDefault();
                      setJoinOpen(true);
                    }
                  }}
                  className="border-primary-200 text-primary-700 rounded-card flex-1 border-2 px-3 py-2.5 text-center text-sm font-extrabold transition active:scale-[0.98]"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Plus className="size-4" />
                    {t("addProducts")}
                  </span>
                </Link>
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void payFromOpen()}
                    disabled={actionBusy === "paybtn" || actionBusy === "order"}
                    className="bg-primary-600 hover:bg-primary-700 rounded-card flex-1 border-2 border-transparent px-3 py-2.5 text-sm font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {actionBusy === "paybtn" || actionBusy === "order" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Lock className="size-4" />
                      )}
                      {t("payCtaShort")}
                    </span>
                  </button>
                )}
              </>
            )}
            {!open && canPayNow && (
              <button
                type="button"
                onClick={() => void payNow()}
                disabled={actionBusy === "roompay"}
                className="bg-primary-600 hover:bg-primary-700 rounded-card flex-1 border-2 border-transparent px-4 py-2.5 text-sm font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-1.5">
                  {actionBusy === "roompay" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Lock className="size-4" />
                  )}
                  {t("roomPayCta")}
                </span>
              </button>
            )}
            {!open &&
              !canPayNow &&
              isCaptain &&
              !cart.ordered &&
              items.length > 0 && (
                <button
                  type="button"
                  onClick={() => void order()}
                  disabled={actionBusy === "order"}
                  className="bg-primary-600 hover:bg-primary-700 rounded-card flex-1 border-2 border-transparent px-4 py-2.5 text-sm font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {actionBusy === "order" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowRight className="size-4 rtl:-scale-x-100" />
                    )}
                    {t("orderCta")}
                  </span>
                </button>
              )}
          </div>
        </div>
      </div>

      {/* ── FEUILLE « COMMANDE PAYÉE » — transition impayé→payé vue en direct.
          La nav du bas reste en place (feuille par-dessus, comme le reste de
          l'app) ; capitaine → bouton vers SA commande, invité → fermer. ── */}
      {paidPopup && (
        <PaidCelebrationSheet
          title={t("roomPaidTitle")}
          desc={isCaptain ? t("roomPaidDescCaptain") : t("roomPaidDescGuest")}
          onClose={() => setPaidPopup(false)}
        >
          <div className="mt-4 flex flex-col gap-2">
            {isCaptain && cart.order_id ? (
              <button
                type="button"
                onClick={() => {
                  setPaidPopup(false);
                  router.push(`/commandes/${cart.order_id}`);
                }}
                className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm px-4 py-3.5 font-extrabold text-white transition active:scale-[0.98]"
              >
                {t("seeOrder")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPaidPopup(false)}
                className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm px-4 py-3.5 font-extrabold text-white transition active:scale-[0.98]"
              >
                {t("paidPopupClose")}
              </button>
            )}
            {isCaptain && cart.order_id && (
              <button
                type="button"
                onClick={() => setPaidPopup(false)}
                className="text-muted hover:text-foreground rounded-md py-2.5 text-sm font-bold transition"
              >
                {t("paidPopupClose")}
              </button>
            )}
          </div>
        </PaidCelebrationSheet>
      )}

      {/* ── FEUILLE « REJOINDRE » (invité, 1ʳᵉ visite) ── */}
      {joinOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[rgba(11,11,15,0.5)] backdrop-blur-[2px] sm:items-center"
          onClick={() => setJoinOpen(false)}
        >
          <div
            className="bg-surface rounded-t-panel-lg sm:rounded-panel-lg w-full max-w-[420px] px-5 pt-2 pb-[calc(1.75rem+env(safe-area-inset-bottom))] sm:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-border mx-auto mb-4 h-[5px] w-9 rounded-full sm:hidden" />
            <div className="bg-primary-50 text-primary-600 mx-auto mb-3 grid size-[54px] place-items-center rounded-lg">
              <UserPlus className="size-[26px]" />
            </div>
            <h3 className="text-foreground text-heading-sm text-center font-extrabold tracking-[-0.4px]">
              {t("joinTitle", { name: view.captain_name ?? t("captain") })}
            </h3>
            <p className="text-muted text-body-sm mx-auto mt-1.5 max-w-[320px] text-center font-semibold">
              {t("joinBody")}
            </p>
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value.slice(0, 24))}
              placeholder={t("joinPlaceholder")}
              maxLength={24}
              className="border-border bg-surface-2 text-foreground rounded-card mt-4 w-full border px-4 py-3 text-center text-sm font-bold outline-none focus:border-[color:var(--color-primary-500)]"
            />
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void doJoin(false)}
                disabled={joinBusy}
                className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm px-4 py-3.5 font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
              >
                {joinBusy ? (
                  <Loader2 className="mx-auto size-5 animate-spin" />
                ) : (
                  t("joinCta")
                )}
              </button>
              <button
                type="button"
                onClick={() => void doJoin(true)}
                disabled={joinBusy}
                className="text-muted hover:text-foreground rounded-md py-2.5 text-sm font-bold transition"
              >
                {t("joinSkip")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Banner({
  icon: Icon,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "amber" | "success" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-card text-body-sm flex items-start gap-2 border px-3.5 py-2.5 font-semibold",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "success" &&
          "border-success-200 bg-success-50 text-success-800",
        tone === "muted" && "border-border bg-surface text-muted"
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * Récupération du panier partagé (mig 0423) — le PROPRIÉTAIRE choisit retrait
 * ou livraison EXPRESS + une de SES adresses ; les membres voient le choix
 * (ils savent ce qu'ils paieront). Frais recalculés SERVEUR à la commande.
 */
function RecoveryCard({
  cart,
  merchantId,
  isCaptain,
  captainName,
  onSaved,
}: {
  cart: SharedCartView["cart"];
  /** Sert à juger chaque adresse contre le RAYON DE LIVRAISON du commerçant. */
  merchantId: string | null;
  isCaptain: boolean;
  captainName: string;
  onSaved: () => void;
}) {
  const t = useTranslations("sharedCart");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<
    | {
        id: string;
        address_text: string;
        lat: number | null;
        lng: number | null;
        distance_km: number | null;
        fee_da: number | null;
        /** Hors du rayon de livraison du commerçant → non sélectionnable. */
        out_of_range: boolean;
      }[]
    | null
  >(null);

  const openEdit = async () => {
    setEditing(true);
    setErr(null);
    if (addresses === null) {
      // Adresses jugées POUR CE commerçant : celles qui sortent de son rayon
      // arrivent déjà marquées, on ne les propose pas comme un choix valable.
      setAddresses(await getMyDeliveryAddresses(merchantId ?? undefined));
    }
  };

  const save = async (
    fulfillment: "pickup" | "delivery",
    addressId?: string
  ) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await setSharedCartDelivery({
      cart_id: cart.id,
      fulfillment,
      address_id: addressId ?? null,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setEditing(false);
    onSaved();
  };

  const isDelivery = cart.fulfillment_type === "delivery";

  return (
    <div className="border-border bg-surface rounded-lg border p-3.5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "rounded-control-lg grid size-9 shrink-0 place-items-center",
            isDelivery
              ? "bg-primary-50 text-primary-700"
              : "bg-surface-2 text-subtle"
          )}
        >
          {isDelivery ? (
            <Truck className="size-4.5" />
          ) : (
            <Store className="size-4.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-body font-extrabold">
            {isDelivery ? t("recoveryDelivery") : t("recoveryPickup")}
          </p>
          <p className="text-muted text-caption-lg truncate font-semibold">
            {isDelivery && cart.delivery_address_text
              ? cart.delivery_address_text
              : t("recoveryByOwner", { name: captainName })}
          </p>
        </div>
        {isCaptain && !editing && (
          <button
            type="button"
            onClick={() => void openEdit()}
            className="border-border text-foreground text-label shrink-0 rounded-full border px-3 py-1.5 font-bold"
          >
            {t("recoveryEdit")}
          </button>
        )}
      </div>

      {isCaptain && editing && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save("pickup")}
              className={cn(
                "text-label-lg flex-1 rounded-md border-2 px-3 py-2 font-extrabold disabled:opacity-60",
                !isDelivery
                  ? "border-primary-600 text-primary-700 bg-primary-50"
                  : "border-border text-muted"
              )}
            >
              {t("recoveryPickup")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (addresses && addresses.length === 0) {
                  setErr(t("recoveryNoAddr"));
                  return;
                }
              }}
              className={cn(
                "text-label-lg flex-1 rounded-md border-2 px-3 py-2 font-extrabold disabled:opacity-60",
                isDelivery
                  ? "border-primary-600 text-primary-700 bg-primary-50"
                  : "border-border text-muted"
              )}
            >
              {t("recoveryDelivery")}
            </button>
          </div>
          {/* Adresses du propriétaire : un tap = livraison vers cette adresse. */}
          {addresses === null ? (
            <div className="text-muted flex items-center gap-2 px-1 text-xs font-semibold">
              <Loader2 className="size-3.5 animate-spin" /> …
            </div>
          ) : addresses.length === 0 ? (
            <p className="text-muted px-1 text-xs font-semibold">
              {t("recoveryNoAddr")}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-muted text-caption px-1 font-bold tracking-wide uppercase">
                {t("recoveryChooseAddr")}
              </p>
              {addresses.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={
                    busy || a.lat == null || a.lng == null || a.out_of_range
                  }
                  onClick={() => void save("delivery", a.id)}
                  className="border-border bg-surface-2 text-label-lg flex w-full items-center gap-2 rounded-md border px-3 py-2 text-start font-semibold disabled:opacity-50"
                >
                  <Truck className="text-primary-700 size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.address_text}</span>
                    {a.out_of_range ? (
                      <small className="text-caption block truncate font-bold text-rose-600">
                        {t("recoveryOutOfRange")}
                        {a.distance_km != null ? ` · ${a.distance_km} km` : ""}
                      </small>
                    ) : a.fee_da != null ? (
                      <small className="text-muted text-caption block truncate font-semibold">
                        {t("recoveryFeeFrom", { fee: a.fee_da })}
                      </small>
                    ) : null}
                  </span>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                </button>
              ))}
            </div>
          )}
          {err && (
            <p className="px-1 text-xs font-semibold text-rose-600">{err}</p>
          )}
        </div>
      )}
    </div>
  );
}
