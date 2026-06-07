import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";

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
        <div className="space-y-4">
          <Link
            href="/driver"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#757575]"
          >
            <ArrowLeft className="size-4" /> Accueil
          </Link>
          <div className="rounded-[14px] border border-[#f5e0a1] bg-[#fff8e5] p-4 text-sm font-medium text-[#8b6500]">
            {link.status === "pending"
              ? `Demande en attente chez ${merchant.name}.`
              : `Accès retiré chez ${merchant.name}.`}
          </div>
        </div>
      </DriverShell>
    );
  }

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="space-y-5">
        <Link
          href="/driver"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#757575]"
        >
          <ArrowLeft className="size-4" />
          Accueil
        </Link>
        <header className="space-y-0.5">
          <p className="text-xs font-bold tracking-wide text-[#757575] uppercase">
            Tournées
          </p>
          <h1 className="text-[22px] font-extrabold tracking-tight text-[#0a0a0a]">
            {merchant.name}
          </h1>
        </header>

        {merchant.tours_enabled ? (
          <Link
            href={`/driver/m/${link.id}/tours`}
            className="flex items-center gap-3 rounded-[14px] bg-white p-4 shadow-[0_4px_16px_rgba(0,0,0,.06)] active:scale-[0.99]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f5f5f5] text-lg">
              📅
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#0a0a0a]">Tournée</p>
              <p className="text-xs font-medium text-[#757575]">
                Choisis un créneau et fais ta tournée.
              </p>
            </div>
            <ChevronRight className="size-[18px] text-[#9e9e9e]" />
          </Link>
        ) : (
          <p className="text-sm font-medium text-[#757575]">
            Ce commerçant n&apos;a pas activé la Tournée. L&apos;Express, lui,
            arrive automatiquement quand tu es en ligne — pas besoin de passer
            par ici.
          </p>
        )}
      </div>
    </DriverShell>
  );
}
