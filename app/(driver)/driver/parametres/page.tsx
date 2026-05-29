import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentDriver } from "@/lib/auth/driver";
import { createClient } from "@/lib/supabase/server";
import { DriverShell } from "@/components/driver/driver-shell";
import { DeleteAccountSection } from "@/components/driver/delete-account-section";
import { ProfileHub } from "@/components/driver/profile/profile-hub";

export const dynamic = "force-dynamic";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default async function DriverProfilePage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // === Stats réelles (aucune donnée inventée) ===
  // Nb de commerçants actifs.
  const { count: merchants } = await supabase
    .from("merchant_drivers")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", driver.id)
    .eq("status", "active");

  // Courses livrées + temps moyen de livraison (pickup → livré).
  const { data: delivered } = await supabase
    .from("orders")
    .select("delivery_picked_up_at, delivery_delivered_at")
    .eq("delivery_driver_id", driver.id)
    .not("delivery_delivered_at", "is", null)
    .order("delivery_delivered_at", { ascending: false })
    .limit(300);

  const rows = delivered ?? [];
  const courses = rows.length;
  const durations = rows
    .map((o) =>
      o.delivery_picked_up_at && o.delivery_delivered_at
        ? (new Date(o.delivery_delivered_at).getTime() -
            new Date(o.delivery_picked_up_at).getTime()) /
          60000
        : null
    )
    .filter((m): m is number => m != null && m > 0 && m < 600);
  const avgMin =
    durations.length > 0
      ? Math.round(durations.reduce((s, m) => s + m, 0) / durations.length)
      : null;

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Link
        href="/driver"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#757575]"
      >
        <ArrowLeft className="size-4" />
        Accueil
      </Link>

      <ProfileHub
        fullName={driver.full_name}
        phone={driver.phone}
        initials={initialsOf(driver.full_name)}
        isActive={(merchants ?? 0) > 0}
        stats={{ courses, avgMin, merchants: merchants ?? 0 }}
      />

      <div className="mt-5">
        <DeleteAccountSection />
      </div>
    </DriverShell>
  );
}
