import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import {
  DriverInfoManager,
  type SelfDoc,
  type SelfPayout,
  type SelfRequest,
  type SelfVehicle,
} from "@/components/driver/profile/driver-info-manager";

export const dynamic = "force-dynamic";

export default async function DriverProfilPage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  // Le blocage est géré par le layout ; ici on gère gel/vérif.

  const { data: d } = await supabase
    .from("drivers")
    .select(
      "vehicle_type, vehicle_brand, vehicle_model, vehicle_color, vehicle_year, vehicle_plate, national_id_number, id_card_number, wilaya, address"
    )
    .eq("id", driver.id)
    .maybeSingle();

  const [{ data: docsRaw }, { data: payoutsRaw }, { data: reqRaw }] =
    await Promise.all([
      supabase
        .from("driver_documents")
        .select("id, doc_type, number, issued_at, expires_at, file_url")
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

  // URLs signées (1 h) pour relire ses propres scans (bucket privé).
  const docs: SelfDoc[] = await Promise.all(
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
      };
    })
  );

  const vehicle: SelfVehicle = {
    vehicle_type: d?.vehicle_type ?? null,
    vehicle_brand: d?.vehicle_brand ?? null,
    vehicle_model: d?.vehicle_model ?? null,
    vehicle_color: d?.vehicle_color ?? null,
    vehicle_year: d?.vehicle_year ?? null,
    vehicle_plate: d?.vehicle_plate ?? null,
    national_id_number: d?.national_id_number ?? null,
    id_card_number: d?.id_card_number ?? null,
    wilaya: d?.wilaya ?? null,
    address: d?.address ?? null,
  };

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <DriverInfoManager
        verified={driver.is_verified}
        vehicle={vehicle}
        documents={docs}
        payouts={(payoutsRaw ?? []) as SelfPayout[]}
        requests={(reqRaw ?? []) as SelfRequest[]}
      />
    </DriverShell>
  );
}
