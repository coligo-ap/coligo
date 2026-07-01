import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { CalendarDays, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { PartnerBackHeader } from "@/components/shared/partner-ui";

export const dynamic = "force-dynamic";

/**
 * Espace commerçant côté livreur — désormais dédié à la TOURNÉE.
 *
 * L'Express ne passe plus par ici : il est reçu globalement (en ligne) et joué
 * sur /driver/course/[orderId], sans inscription chez le commerçant. Cette page
 * ne sert qu'aux livreurs RATTACHÉS à un commerçant pour ses tournées.
 */
export default async function DriverMerchantSpacePage({
  params,
}: {
  params: Promise<{ mdId: string }>;
}) {
  const { mdId } = await params;
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  const { data: link } = await supabase
    .from("merchant_drivers")
    .select("id, status, merchants ( id, name, tours_enabled )")
    .eq("id", mdId)
    .eq("driver_id", driver.id)
    .maybeSingle();

  if (!link) notFound();
  const merchant = Array.isArray(link.merchants)
    ? link.merchants[0]
    : link.merchants;
  if (!merchant) notFound();

  if (link.status !== "active") {
    return (
      <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
        <PartnerBackHeader
          href="/driver"
          title={merchant.name}
          subtitle="Tournées"
        />
        <div
          className="rounded-[14px] px-4 py-3 text-sm font-medium"
          style={{ background: "rgba(245,158,11,.12)", color: "#c2790a" }}
        >
          {link.status === "pending"
            ? `Demande en attente chez ${merchant.name}.`
            : `Accès retiré chez ${merchant.name}.`}
        </div>
      </DriverShell>
    );
  }

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <PartnerBackHeader
        href="/driver"
        title={merchant.name}
        subtitle="Tournées"
      />

      {merchant.tours_enabled ? (
        <Link
          href={`/driver/m/${link.id}/tours`}
          className="flex items-center gap-3 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4 active:scale-[0.99]"
        >
          <span
            className="grid size-11 shrink-0 place-items-center rounded-[14px]"
            style={{ background: "rgba(108,43,217,.1)", color: "#6c2bd9" }}
          >
            <CalendarDays className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[var(--d-ink)]">Tournée</p>
            <p className="text-xs font-medium text-[var(--d-muted)]">
              Choisis un créneau et fais ta tournée.
            </p>
          </div>
          <ChevronRight className="size-[18px] text-[var(--d-muted)] rtl:rotate-180" />
        </Link>
      ) : (
        <p className="text-sm font-medium text-[var(--d-muted)]">
          Ce commerçant n&apos;a pas activé la Tournée. L&apos;Express, lui,
          arrive automatiquement quand tu es en ligne — pas besoin de passer par
          ici.
        </p>
      )}
    </DriverShell>
  );
}
