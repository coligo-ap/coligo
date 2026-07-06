"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, Gift, Info, Plus, Ticket, Wallet, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import { claimPlatformPromo } from "@/app/(customer)/codes-promo/actions";
import type {
  CustomerVoucher,
  PlatformPromoCode,
} from "@/lib/customer/platform-promos";

// =============================================================================
// PlatformPromosView — saisie d'un code, liste des codes plateforme disponibles
// (cartes ticket + conditions), et liste des bons d'achat crédités sur Coligo Pay.
// =============================================================================

export function PlatformPromosView({
  codes,
  vouchers,
}: {
  codes: PlatformPromoCode[];
  vouchers: CustomerVoucher[];
}) {
  const t = useTranslations("promosPage");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setMsg(null);
    startTransition(async () => {
      const res = await claimPlatformPromo(value);
      if (res.ok) {
        setMsg({
          kind: "ok",
          text: res.reason === "already" ? t("addAlready") : t("addSuccess"),
        });
        setCode("");
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  }

  const activeVouchers = vouchers.filter((v) => v.status === "granted");

  return (
    <div className="space-y-7">
      {/* Saisie d'un code */}
      <section>
        <form
          onSubmit={submit}
          className="border-border bg-surface flex items-center gap-2 rounded-[16px] border p-2 shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]"
        >
          <Ticket className="text-subtle ms-1.5 size-5 shrink-0" />
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t("inputPlaceholder")}
            maxLength={40}
            className="text-foreground placeholder:text-subtle min-w-0 flex-1 bg-transparent font-mono text-base font-bold tracking-wider uppercase outline-none"
            aria-label={t("inputPlaceholder")}
          />
          <button
            type="submit"
            disabled={pending || !code.trim()}
            className="bg-primary-600 hover:bg-primary-700 inline-flex shrink-0 items-center gap-1.5 rounded-[12px] px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-50"
          >
            <Plus className="size-4" />
            {t("addButton")}
          </button>
        </form>
        {msg && (
          <p
            className={cn(
              "mt-2 px-1 text-sm font-medium",
              msg.kind === "ok" ? "text-success-700" : "text-danger-700"
            )}
          >
            {msg.text}
          </p>
        )}
      </section>

      {/* Codes disponibles */}
      <section>
        <h2 className="text-muted mb-2.5 px-1 text-[11px] font-extrabold tracking-wide uppercase">
          {t("myCodes")}
        </h2>
        {codes.length === 0 ? (
          <EmptyHint icon={<Ticket className="size-5" />} text={t("noCodes")} />
        ) : (
          <div className="space-y-2.5">
            {codes.map((c) => (
              <PromoCodeCard key={c.id} promo={c} />
            ))}
          </div>
        )}
      </section>

      {/* Bons d'achat */}
      <section>
        <h2 className="text-muted mb-2.5 px-1 text-[11px] font-extrabold tracking-wide uppercase">
          {t("myVouchers")}
        </h2>
        {activeVouchers.length === 0 ? (
          <EmptyHint
            icon={<Gift className="size-5" />}
            text={t("noVouchers")}
          />
        ) : (
          <div className="space-y-2.5">
            {activeVouchers.map((v) => (
              <VoucherCard key={v.id} voucher={v} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="border-border bg-surface text-muted flex flex-col items-center gap-2 rounded-[16px] border border-dashed px-6 py-8 text-center text-sm">
      <span className="text-subtle">{icon}</span>
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carte d'un code plateforme (ticket pointillé + conditions).
// ---------------------------------------------------------------------------
function PromoCodeCard({ promo }: { promo: PlatformPromoCode }) {
  const t = useTranslations("promosPage");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const code = (promo.code ?? "").toUpperCase();
  const title = (locale === "ar" && promo.title_ar) || promo.title_fr;
  const discount =
    promo.discount_kind === "percent"
      ? t("discountPercent", { value: promo.discount_value })
      : t("discountAmount", { amount: formatDA(promo.discount_value) });

  const conditions = useMemo(() => {
    const list: string[] = [];
    if (promo.min_subtotal_da != null) {
      list.push(
        t("condMinSubtotal", { amount: formatDA(promo.min_subtotal_da) })
      );
    }
    if (promo.max_discount_da != null) {
      list.push(
        t("condMaxDiscount", { amount: formatDA(promo.max_discount_da) })
      );
    }
    if (promo.online_only) list.push(t("condOnlineOnly"));
    if (promo.max_uses_per_customer != null) {
      list.push(
        t("condPerCustomer", {
          count: promo.max_uses_per_customer,
          used: promo.used_by_me,
        })
      );
    }
    if (promo.ends_at) {
      const d = new Date(promo.ends_at).toLocaleDateString(
        locale === "ar" ? "ar-DZ" : "fr-DZ",
        { day: "numeric", month: "long", year: "numeric" }
      );
      list.push(t("condExpires", { date: d }));
    }
    if (list.length === 0) list.push(t("condNone"));
    return list;
  }, [promo, t, locale]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard indisponible : on signale quand même la copie */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      {/* Fond bg-primary-50 SOLIDE (remappé par le thème sombre) — pas un dégradé
          from-primary-* + dark: (basé système) qui restait clair en sombre. */}
      <div className="border-primary-300 bg-primary-50 relative overflow-hidden rounded-[16px] border border-dashed px-3.5 py-3">
        <div className="flex items-center gap-3">
          <span className="bg-primary-600 grid size-11 shrink-0 place-items-center rounded-[12px] text-white shadow-sm">
            <Ticket className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-primary-800 dark:text-primary-200 truncate text-sm font-extrabold">
                {title}
              </span>
              <span className="text-primary-600 shrink-0 text-xs font-black">
                {discount}
              </span>
            </div>
            <button
              type="button"
              onClick={copy}
              className="mt-1 flex items-center gap-2"
            >
              {/* Plaque du code : TOUJOURS blanche (bg-[#fff] non remappé par le
                  thème sombre) → rendu « ticket » et lisibilité maximale. */}
              <span className="border-primary-300 rounded-md border bg-[#fff] px-2 py-0.5 font-mono text-sm font-black tracking-wider text-[#6c2bd9]">
                {code}
              </span>
              <span className="text-primary-500/90 inline-flex items-center gap-1 text-[11px] font-medium">
                {copied ? (
                  <>
                    <Check className="size-3" /> {t("copied")}
                  </>
                ) : (
                  <>
                    <Copy className="size-3" /> {t("tapToCopy")}
                  </>
                )}
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="hover:bg-primary-100/60 dark:hover:bg-primary-900/40 grid size-9 shrink-0 place-items-center rounded-full text-[#2563eb]"
            aria-label={t("seeConditions")}
          >
            <Info className="size-5" />
          </button>
        </div>
      </div>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="bg-surface flex w-full max-w-md flex-col rounded-t-[20px] shadow-xl sm:rounded-[20px]">
              <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
                <h3 className="text-foreground text-lg font-bold">
                  {t("conditionsTitle")}
                </h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-muted hover:bg-surface-2 rounded-full p-1.5"
                  aria-label={t("close")}
                >
                  <X className="size-5" />
                </button>
              </header>
              <div className="space-y-3 px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="border-primary-300 bg-primary-50 text-primary-700 rounded-md border px-2.5 py-1 font-mono text-base font-black tracking-wider">
                    {code}
                  </span>
                  <span className="text-primary-600 text-sm font-black">
                    {discount}
                  </span>
                </div>
                <p className="text-foreground text-sm font-semibold">{title}</p>
                <ul className="space-y-1.5">
                  {conditions.map((c, i) => (
                    <li
                      key={i}
                      className="text-muted flex items-start gap-2 text-sm"
                    >
                      <Check className="text-primary-500 mt-0.5 size-4 shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Carte d'un bon d'achat (crédité sur Coligo Pay).
// ---------------------------------------------------------------------------
function VoucherCard({ voucher }: { voucher: CustomerVoucher }) {
  const t = useTranslations("promosPage");
  const locale = useLocale();
  const label =
    (locale === "ar" && voucher.label_ar) ||
    voucher.label_fr ||
    t("voucherDefault");
  const date = new Date(voucher.created_at).toLocaleDateString(
    locale === "ar" ? "ar-DZ" : "fr-DZ",
    { day: "numeric", month: "long", year: "numeric" }
  );
  return (
    <Link
      href="/coligo-pay"
      className="border-border bg-surface hover:border-primary-300 flex items-center gap-3 rounded-[16px] border px-3.5 py-3 shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)] transition-colors"
    >
      <span className="bg-success-50 text-success-700 grid size-11 shrink-0 place-items-center rounded-[12px]">
        <Gift className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-extrabold">
          {label}
        </p>
        <p className="text-muted mt-0.5 inline-flex items-center gap-1 text-xs font-medium">
          <Wallet className="size-3.5" />
          {t("voucherCredited")} · {date}
        </p>
      </div>
      <span className="text-success-700 shrink-0 text-base font-black tabular-nums">
        + {formatDA(voucher.amount_da)}
      </span>
    </Link>
  );
}
