import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { createClient } from "@/lib/supabase/server";
import { DriverShell } from "@/components/driver/driver-shell";
import { CompteView } from "@/components/driver/profile/compte-view";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import {
  DriverInfoManager,
  type SelfDoc,
  type SelfPayout,
  type SelfRequest,
  type SelfVehicle,
} from "@/components/driver/profile/driver-info-manager";

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
      "rating_avg, rating_count, vehicle_label, vehicle_plate, payout_method, payout_details, joined_year, created_at, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, vehicle_year, national_id_number, id_card_number, wilaya, address"
    )
    .eq("id", driver.id)
    .maybeSingle();

  // Données « Mes informations » (gérées en place, sans page séparée).
  const [{ data: docsRaw }, { data: payoutsRaw }, { data: reqRaw }] =
    await Promise.all([
      supabase
        .from("driver_documents")
        .select(
          "id, doc_type, number, issued_at, expires_at, file_url, status, review_note"
        )
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("driver_payout_methods")
        .select("id, method, label, account_number, account_name, is_default")
        .eq("driver_id", driver.id)
        .order("is_default", { ascending: false }),
      supabase
        .from("driver_change_requests")
        .select("id, kind, note, status, review_note, created_at")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
  const infoDocs: SelfDoc[] = await Promise.all(
    (docsRaw ?? []).map(async (x) => {
      let scanUrl: string | null = null;
      if (x.file_url) {
        const { data: s } = await supabase.storage
          .from("driver-docs")
          .createSignedUrl(x.file_url as string, 3600);
        scanUrl = s?.signedUrl ?? null;
      }
      return {
        id: x.id,
        doc_type: x.doc_type,
        number: x.number,
        issued_at: x.issued_at,
        expires_at: x.expires_at,
        hasScan: !!x.file_url,
        scanUrl,
        status: x.status,
        review_note: x.review_note,
      };
    })
  );

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
    vehicle_type?: string | null;
    vehicle_brand?: string | null;
    vehicle_model?: string | null;
    vehicle_color?: string | null;
    vehicle_year?: number | null;
    national_id_number?: string | null;
    id_card_number?: string | null;
    wilaya?: string | null;
    address?: string | null;
  };
  const joinedYear =
    p.joined_year ??
    (p.created_at ? new Date(p.created_at).getFullYear() : null);

  const infoVehicle: SelfVehicle = {
    vehicle_type: p.vehicle_type ?? null,
    vehicle_brand: p.vehicle_brand ?? null,
    vehicle_model: p.vehicle_model ?? null,
    vehicle_color: p.vehicle_color ?? null,
    vehicle_year: p.vehicle_year ?? null,
    vehicle_plate: p.vehicle_plate ?? null,
    national_id_number: p.national_id_number ?? null,
    id_card_number: p.id_card_number ?? null,
    wilaya: p.wilaya ?? null,
    address: p.address ?? null,
  };

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
          verified: driver.is_verified,
          frozen: driver.is_frozen,
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
      >
        <DriverInfoManager
          verified={driver.is_verified}
          vehicle={infoVehicle}
          documents={infoDocs}
          payouts={(payoutsRaw ?? []) as SelfPayout[]}
          requests={(reqRaw ?? []) as SelfRequest[]}
        />
        {/* Installer la PWA livreur (« Coligo Livreur ») — masqué si installée/APK */}
        <div className="mt-4">
          <InstallAppButton />
        </div>
      </CompteView>
    </DriverShell>
  );
}
