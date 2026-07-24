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
  Trash2,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { sharedCartChannel } from "@/lib/realtime/broadcast";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { useConfirm } from "@/components/ui/confirm";
import { AvatarDot } from "@/components/ui/avatar-dot";
import { setLocale } from "@/i18n/actions";
import { addItem, clearMerchantCart } from "@/lib/customer/cart-store";
import { guestJoin, guestSetQty } from "@/app/p/[token]/actions";
import {
  attachOrderToSharedCart,
  cancelCart,
  captainRemoveItem,
  getCartForCheckout,
  lockCart,
  setInvitationsClosed,
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
  const [copied, setCopied] = useState(false);
  // Sections par participant OUVRANTES/FERMANTES — tout ouvert par défaut,
  // l'en-tête (compte + sous-total) reste parlant une fois replié.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [resyncNonce, setResyncNonce] = useState(0);
  const seenItems = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  // ── Lecture (RPC anon token-validée — la même pour capitaine et invités) ──
  const fetchView = useCallback(async () => {
    try {
      const supabase = createClient();
      // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: SharedCartView | null }>;
      const { data } = await rpc("shared_cart_by_token", { p_token: token });
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

  // Fetch initial + temps réel (bump public) + poll filet + reprise.
  useEffect(() => {
    void fetchView();
    const supabase = createClient();
    const channel = supabase
      .channel(sharedCartChannel(token))
      .on("broadcast", { event: "bump" }, () => void fetchView())
      .subscribe();
    const poll = setInterval(() => void fetchView(), 6000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [token, fetchView, resyncNonce]);
  useResumeResync(() => setResyncNonce((n) => n + 1));

  // Capitaine : son member_id vient de la vue.
  useEffect(() => {
    if (isCaptain && view && view !== "notfound") {
      const cap = view.members.find((m) => m.kind === "captain");
      if (cap) setMyMemberId(cap.id);
    }
  }, [isCaptain, view]);

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
        <div className="bg-surface-3 h-24 animate-pulse rounded-[20px]" />
        <div className="bg-surface-3 mt-3 h-64 animate-pulse rounded-[20px]" />
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

  const itemsByMember = members
    .map((m) => ({
      member: m,
      items: items.filter((i) => i.member_id === m.id),
    }))
    .filter((g) => g.items.length > 0);

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

  const stepFor = (it: SCItem) =>
    it.unit && it.unit !== "piece" && !Number.isInteger(it.quantity) ? 0.5 : 1;

  return (
    <div
      className={cn("bg-surface-2 min-h-dvh", showChrome ? "pb-56" : "pb-40")}
    >
      {/* Micro-animation d'apparition des ajouts temps réel. */}
      <style>{`@keyframes scAdd{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}`}</style>

      {/* ── EN-TÊTE ── */}
      <header className="from-primary-500 via-primary-600 to-primary-800 bg-gradient-to-br px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-12 text-white">
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
              className="size-11 shrink-0 rounded-[13px] bg-white object-cover"
            />
          ) : (
            <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-white/15">
              <ShoppingBag className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base leading-tight font-extrabold">
              {merchant?.name}
            </p>
            <p className="text-[12px] font-semibold text-white/80">
              {t("cartOf", { name: view.captain_name ?? t("captain") })}
            </p>
          </div>
          {/* Langues (comme le sélecteur client existant) : FR / AR / EN. */}
          <div className="flex shrink-0 gap-0.5 rounded-full bg-white/15 p-0.5 text-[11px] font-extrabold">
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
          <p className="text-[12px] font-bold text-white/90">
            {t("participants", { count: members.length })}
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-6 max-w-lg space-y-3 px-4">
        {/* ── BANDEAUX D'ÉTAT ── */}
        {cart.status === "locked" && !cart.ordered && (
          <Banner icon={Lock} tone="amber">
            {t("lockedBanner")}
          </Banner>
        )}
        {cart.ordered && (
          <Banner icon={PackageCheck} tone="success">
            {t("orderedBanner")}
            {isCaptain && (
              <Link
                href="/commandes"
                className="ms-1 font-extrabold underline underline-offset-2"
              >
                {t("seeOrder")}
              </Link>
            )}
          </Banner>
        )}
        {cart.status === "expired" && (
          <Banner icon={Hourglass} tone="muted">
            {t("expiredBanner")}
          </Banner>
        )}
        {cart.status === "cancelled" && (
          <Banner icon={X} tone="muted">
            {t("cancelledBanner")}
          </Banner>
        )}
        {open && cart.invitations_closed && (
          <Banner icon={UserX} tone="muted">
            {t("invitesClosedBanner")}
          </Banner>
        )}

        {/* ── CONTRÔLES CAPITAINE ── */}
        {isCaptain && (open || (cart.status === "locked" && !cart.ordered)) && (
          <div className="flex flex-wrap gap-2">
            {open && (
              <>
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold text-white transition-colors"
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
                  className="bg-surface text-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold shadow-sm"
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
                  className="bg-surface text-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold shadow-sm disabled:opacity-60"
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
                  className="bg-surface text-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold shadow-sm disabled:opacity-60"
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
                className="bg-surface text-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold shadow-sm disabled:opacity-60"
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
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 disabled:opacity-60"
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
          <p className="rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
            {actionError}
          </p>
        )}

        {/* ── ARTICLES PAR PARTICIPANT ── */}
        {itemsByMember.length === 0 ? (
          <div className="bg-surface rounded-[20px] p-6 text-center shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
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
              className="bg-surface overflow-hidden rounded-[18px] shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]"
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
                <p className="text-foreground min-w-0 flex-1 truncate text-[13px] font-extrabold">
                  {t("addedBy", { name: memberName(member) })}
                </p>
                {member.id === myMemberId && (
                  <span className="bg-primary-50 text-primary-700 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold">
                    {t("you")}
                  </span>
                )}
                <span className="text-muted shrink-0 text-[11px] font-bold tabular-nums">
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
                        className="bg-surface-2 size-11 shrink-0 rounded-[10px] object-cover"
                      />
                    ) : (
                      <span className="bg-surface-2 text-subtle grid size-11 shrink-0 place-items-center rounded-[10px]">
                        <ShoppingBag className="size-4.5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-bold">
                        {ar && it.name_ar ? it.name_ar : it.name_fr}
                      </p>
                      {it.options.length > 0 && (
                        <p className="text-muted truncate text-[11px]">
                          {it.options
                            .map((o) =>
                              ar && o.name_ar ? o.name_ar : o.name_fr
                            )
                            .join(" · ")}
                        </p>
                      )}
                      <p className="text-muted text-[11px] font-semibold">
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
                          className="bg-surface grid size-7 place-items-center rounded-full shadow-sm active:scale-95"
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
                          className="bg-surface grid size-7 place-items-center rounded-full shadow-sm active:scale-95"
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
            <span className="text-muted text-xs font-bold">{t("total")}</span>
            <span className="text-foreground text-lg font-black tabular-nums">
              {formatDA(total_da)}
            </span>
          </div>
          {merchant?.min_order_da != null &&
            merchant.min_order_da > 0 &&
            total_da < merchant.min_order_da &&
            open && (
              <p className="text-muted mb-2 text-[11px] font-semibold">
                {t("minOrder", { amount: formatDA(merchant.min_order_da) })}
              </p>
            )}
          <div className="flex gap-2">
            {open && (
              <Link
                href={joinedOrCaptain ? `/p/${token}/catalogue` : "#"}
                onClick={(e) => {
                  if (!joinedOrCaptain) {
                    e.preventDefault();
                    setJoinOpen(true);
                  }
                }}
                className={cn(
                  "border-primary-200 text-primary-700 flex-1 rounded-[14px] border-2 px-4 py-3 text-center text-sm font-extrabold transition active:scale-[0.98]",
                  isCaptain && items.length > 0 ? "flex-none" : "flex-1"
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="size-4" />
                  {t("addProducts")}
                </span>
              </Link>
            )}
            {isCaptain && !cart.ordered && items.length > 0 && (
              <button
                type="button"
                onClick={() => void order()}
                disabled={actionBusy === "order"}
                className="bg-primary-600 hover:bg-primary-700 flex-1 rounded-[14px] px-4 py-3 text-sm font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
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

      {/* ── FEUILLE « REJOINDRE » (invité, 1ʳᵉ visite) ── */}
      {joinOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[rgba(11,11,15,0.5)] backdrop-blur-[2px] sm:items-center"
          onClick={() => setJoinOpen(false)}
        >
          <div
            className="bg-surface w-full max-w-[420px] rounded-t-[26px] px-5 pt-2 pb-[calc(1.75rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[26px] sm:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-border mx-auto mb-4 h-[5px] w-9 rounded-full sm:hidden" />
            <div className="bg-primary-50 text-primary-600 mx-auto mb-3 grid size-[54px] place-items-center rounded-[16px]">
              <UserPlus className="size-[26px]" />
            </div>
            <h3 className="text-foreground text-center text-[18px] font-extrabold tracking-[-0.4px]">
              {t("joinTitle", { name: view.captain_name ?? t("captain") })}
            </h3>
            <p className="text-muted mx-auto mt-1.5 max-w-[320px] text-center text-[13px] font-semibold">
              {t("joinBody")}
            </p>
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value.slice(0, 24))}
              placeholder={t("joinPlaceholder")}
              maxLength={24}
              className="border-border bg-surface-2 text-foreground mt-4 w-full rounded-[13px] border px-4 py-3 text-center text-sm font-bold outline-none focus:border-[color:var(--color-primary-500)]"
            />
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void doJoin(false)}
                disabled={joinBusy}
                className="bg-primary-600 hover:bg-primary-700 rounded-[14px] px-4 py-3.5 text-[15px] font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
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
                className="text-muted hover:text-foreground rounded-[12px] py-2.5 text-sm font-bold transition"
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
        "flex items-start gap-2 rounded-[13px] border px-3.5 py-2.5 text-[13px] font-semibold",
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
