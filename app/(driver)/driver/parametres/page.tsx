import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { createClient } from "@/lib/supabase/server";
import { DriverShell } from "@/components/driver/driver-shell";
import { DeleteAccountSection } from "@/components/driver/delete-account-section";
import { CompteView } from "@/components/driver/profile/compte-view";

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

  const { data: prof } = await supabase
    .from("drivers")
    .select(
      "rating_avg, rating_count, vehicle_label, vehicle_plate, payout_method, payout_details, joined_year, created_at"
    )
    .eq("id", driver.id)
    .maybeSingle();

  // Nb de courses livrées (réel).
  const { count: courses } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("delivery_driver_id", driver.id)
    .not("delivery_delivered_at", "is", null);

  // Encours (float) + plafond pour la jauge.
  const [{ data: outstanding }, { data: settings }] = await Promise.all([
    supabase.rpc("driver_outstanding", { p_driver_id: driver.id }),
    supabase
      .from("platform_settings")
      .select("driver_float_cap_da")
      .eq("id", true)
      .single(),
  ]);

  const p = (prof ?? {}) as {
    rating_avg?: number;
    rating_count?: number;
    vehicle_label?: string | null;
    vehicle_plate?: string | null;
    payout_method?: string | null;
    payout_details?: string | null;
    joined_year?: number | null;
    created_at?: string;
  };
  const joinedYear =
    p.joined_year ??
    (p.created_at ? new Date(p.created_at).getFullYear() : null);

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <CompteView
        data={{
          initials: initialsOf(driver.full_name),
          avatarUrl: driver.avatar_url,
          fullName: driver.full_name,
          ratingAvg: Number(p.rating_avg ?? 0),
          ratingCount: p.rating_count ?? 0,
          coursesCount: courses ?? 0,
          joinedYear,
          vehicleLabel: p.vehicle_label ?? null,
          vehiclePlate: p.vehicle_plate ?? null,
          payoutMethod: p.payout_method ?? null,
          payoutDetails: p.payout_details ?? null,
          outstandingDa: Number(outstanding ?? 0),
          capDa: Number(
            (settings as { driver_float_cap_da?: number } | null)
              ?.driver_float_cap_da ?? 8000
          ),
        }}
      />
      <div style={{ marginTop: 18 }}>
        <DeleteAccountSection />
      </div>
    </DriverShell>
  );
}
