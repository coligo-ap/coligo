import type { Metadata } from "next";
import Link from "next/link";
import {
  Ban,
  CreditCard,
  Gift,
  Home,
  Lock,
  ShoppingBag,
  Sparkles,
  Store,
  Timer,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { rateHit } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request-context";
import { buttonVariants } from "@/components/ui/button";
import { StoreBadges } from "@/components/shared/store-badges";
import { cn, formatDA } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Les URLs de cartes ne doivent jamais être indexées (comme /p/<token>).
export const metadata: Metadata = {
  title: "Carte fidélité Coligo",
  robots: { index: false, follow: false },
};

type PeekBalance = {
  merchant_name: string;
  merchant_logo: string | null;
  balance_da: number;
  vouchers_da: number;
};

type Peek = {
  ok: boolean;
  error?: string;
  status?: "printed" | "activated" | "linked" | "blocked";
  brand_name?: string | null;
  brand_logo?: string | null;
  total_da?: number;
  balances?: PeekBalance[];
};

/**
 * LANDING PUBLIQUE d'une carte fidélité scannée HORS app (SPEC-FIDELITE 3.3).
 * C'est un canal d'ACQUISITION : solde consultable (limité), services Coligo,
 * boutons stores, « Crée ton compte pour ne jamais perdre ton solde ».
 * RSC pur (léger, réseau lent OK) ; STRICTEMENT AUCUNE donnée personnelle —
 * une carte LIÉE ne montre ni solde ni identité (règle propriétaire).
 */
export default async function LoyaltyCardLanding({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const t = await getTranslations("wallet");

  // Anti-énumération : limite par IP (fail-open) EN PLUS de la limite
  // par carte dans la RPC (60/h) et des ~80 bits d'entropie du code.
  const ip = await getClientIp();
  const gate = await rateHit("loyalty_peek_ip", ip, 30, 3600);

  const supabase = await createClient();
  let peek: Peek = { ok: false, error: "rate_limited" };
  let isAuthed = false;
  if (gate.allowed) {
    const call = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: Peek | null; error: unknown }>;
    const [{ data }, auth] = await Promise.all([
      call("loyalty_card_public_peek", { p_card_code: code }),
      supabase.auth.getUser(),
    ]);
    peek = data ?? { ok: false, error: "not_found" };
    isAuthed = !!auth.data.user;
  }

  const linkable =
    peek.ok && (peek.status === "printed" || peek.status === "activated");
  const signupHref = linkable
    ? `/inscription?card=${encodeURIComponent(code)}&next=%2Fcashback`
    : "/inscription";
  const loginHref = linkable
    ? `/se-connecter?next=${encodeURIComponent(`/cashback?lier=${code}`)}`
    : "/se-connecter";

  return (
    <main className="bg-surface-2 min-h-dvh pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      {/* HERO violet marque */}
      <section
        className="px-4 pt-[calc(env(safe-area-inset-top)+2.25rem)] pb-16 text-center text-white"
        style={{
          backgroundImage:
            "linear-gradient(140deg, var(--auth-g1, var(--color-primary-600)) 0%, var(--auth-g2, var(--color-primary-700)) 55%, var(--auth-g3, var(--color-primary-800)) 100%)",
        }}
      >
        <p className="text-xs font-extrabold tracking-[0.2em] uppercase opacity-85">
          Coligo · كوليغو
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight">
          {t("loyLandTitle")}
        </h1>
        {peek.ok && peek.brand_name && (
          <p className="mt-1 text-sm font-semibold opacity-90">
            {t("loyLandAt", { merchant: peek.brand_name })}
          </p>
        )}
      </section>

      <div className="mx-auto -mt-10 max-w-md px-4">
        {/* CARTE : état + solde limité (jamais de donnée personnelle) */}
        <div className="rounded-panel-lg border-border bg-surface border p-5 text-center">
          {!peek.ok ? (
            <StateBlock
              icon={<CreditCard className="text-muted size-9" />}
              title={
                peek.error === "rate_limited"
                  ? t("loyErrRate")
                  : t("loyLandUnknown")
              }
            />
          ) : peek.status === "blocked" ? (
            <StateBlock
              icon={<Ban className="text-danger-600 size-9" />}
              title={t("loyLandBlockedMsg")}
            />
          ) : peek.status === "linked" ? (
            <StateBlock
              icon={<Lock className="text-primary-600 size-9" />}
              title={t("loyLandLinked")}
            />
          ) : (
            <>
              <p className="text-muted text-xs font-bold tracking-wide uppercase">
                {t("loyLandBalance")}
              </p>
              <p className="text-primary-700 mt-1 text-5xl font-black tabular-nums">
                {formatDA(peek.total_da ?? 0)}
              </p>
              {(peek.balances ?? []).length > 0 ? (
                <ul className="mt-4 space-y-2 text-start">
                  {(peek.balances ?? []).map((b) => (
                    <li
                      key={b.merchant_name}
                      className="border-border bg-surface-2 flex items-center gap-3 rounded-md border p-3"
                    >
                      {b.merchant_logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={b.merchant_logo}
                          alt=""
                          loading="lazy"
                          className="bg-surface-2 size-9 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <Store className="text-primary-600 size-6 shrink-0" />
                      )}
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm font-bold">
                        {b.merchant_name}
                      </span>
                      <span className="text-foreground text-base font-extrabold tabular-nums">
                        {formatDA(b.balance_da)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted mt-3 text-sm font-medium">
                  {t("loyLandPrinted")}
                </p>
              )}
            </>
          )}
        </div>

        {/* CTA principal : ne jamais perdre son solde */}
        {peek.ok && peek.status !== "blocked" && (
          <div className="mt-4 space-y-2">
            {peek.status === "linked" ? (
              <Link
                href="/cashback"
                className={cn(buttonVariants({ size: "lg" }), "h-14 w-full")}
              >
                {t("loyLandOpenApp")}
              </Link>
            ) : isAuthed && linkable ? (
              <Link
                href={`/cashback?lier=${encodeURIComponent(code)}`}
                className={cn(buttonVariants({ size: "lg" }), "h-14 w-full")}
              >
                <Gift className="size-5" />
                {t("loyLandLinkMine")}
              </Link>
            ) : (
              <>
                <p className="text-foreground text-center text-sm font-bold">
                  {t("loyLandCta")}
                </p>
                <Link
                  href={signupHref}
                  className={cn(buttonVariants({ size: "lg" }), "h-14 w-full")}
                >
                  <Sparkles className="size-5" />
                  {t("loyLandCtaBtn")}
                </Link>
                <Link
                  href={loginHref}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "h-12 w-full"
                  )}
                >
                  {t("loyLandLogin")}
                </Link>
              </>
            )}
          </div>
        )}

        {/* SERVICES COLIGO — l'argument d'acquisition */}
        <div className="rounded-panel-lg border-border bg-surface mt-5 border p-4">
          <p className="text-foreground text-sm font-extrabold">
            {t("loyLandServicesTitle")}
          </p>
          <ul className="mt-3 space-y-3">
            <ServiceRow
              icon={<Timer className="size-4" />}
              text={t("loyLandService1")}
            />
            <ServiceRow
              icon={<Home className="size-4" />}
              text={t("loyLandService2")}
            />
            <ServiceRow
              icon={<ShoppingBag className="size-4" />}
              text={t("loyLandService3")}
            />
          </ul>
        </div>

        {/* Stores */}
        <div className="mt-5 text-center">
          <p className="text-muted mb-2 text-xs font-bold tracking-wide uppercase">
            {t("loyLandApps")}
          </p>
          <div className="flex justify-center">
            <StoreBadges size="sm" only="both" />
          </div>
        </div>
      </div>
    </main>
  );
}

function StateBlock({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="py-3">
      <div className="mx-auto w-fit">{icon}</div>
      <p className="text-foreground mt-2 text-base font-bold">{title}</p>
    </div>
  );
}

function ServiceRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="bg-primary-50 text-primary-600 flex size-8 shrink-0 items-center justify-center rounded-full">
        {icon}
      </span>
      <span className="text-muted text-sm font-semibold">{text}</span>
    </li>
  );
}
