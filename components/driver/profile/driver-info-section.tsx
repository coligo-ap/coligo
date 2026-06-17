import { createClient } from "@/lib/supabase/server";
import {
  DriverInfoManager,
  type SelfDoc,
  type SelfPayout,
  type SelfRequest,
  type SelfVehicle,
} from "@/components/driver/profile/driver-info-manager";

/**
 * Section « Mes informations » du compte (véhicule, pièces + scans, versements,
 * demandes). Composant SERVEUR async streamé via <Suspense> par la page Compte :
 * son fetch lourd (notamment les URLs signées des pièces) NE BLOQUE PAS
 * l'affichage du résumé (hero/stats), qui vient de TanStack Query.
 * Auth déjà garantie par la page ; RLS appliquées sur chaque requête.
 */
export async function DriverInfoSection({
  driverId,
  verified,
}: {
  driverId: string;
  verified: boolean;
}) {
  const supabase = await createClient();

  const [
    { data: prof },
    { data: docsRaw },
    { data: payoutsRaw },
    { data: reqRaw },
  ] = await Promise.all([
    supabase
      .from("drivers")
      .select(
        "vehicle_type, vehicle_brand, vehicle_model, vehicle_color, vehicle_year, vehicle_plate, national_id_number, id_card_number, wilaya, address"
      )
      .eq("id", driverId)
      .maybeSingle(),
    supabase
      .from("driver_documents")
      .select(
        "id, doc_type, number, issued_at, expires_at, file_url, status, review_note"
      )
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false }),
    supabase
      .from("driver_payout_methods")
      .select("id, method, label, account_number, account_name, is_default")
      .eq("driver_id", driverId)
      .order("is_default", { ascending: false }),
    supabase
      .from("driver_change_requests")
      .select("id, kind, note, status, review_note, created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const documents: SelfDoc[] = await Promise.all(
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

  const pv = (prof ?? {}) as {
    vehicle_type?: string | null;
    vehicle_brand?: string | null;
    vehicle_model?: string | null;
    vehicle_color?: string | null;
    vehicle_year?: number | null;
    vehicle_plate?: string | null;
    national_id_number?: string | null;
    id_card_number?: string | null;
    wilaya?: string | null;
    address?: string | null;
  };
  const vehicle: SelfVehicle = {
    vehicle_type: pv.vehicle_type ?? null,
    vehicle_brand: pv.vehicle_brand ?? null,
    vehicle_model: pv.vehicle_model ?? null,
    vehicle_color: pv.vehicle_color ?? null,
    vehicle_year: pv.vehicle_year ?? null,
    vehicle_plate: pv.vehicle_plate ?? null,
    national_id_number: pv.national_id_number ?? null,
    id_card_number: pv.id_card_number ?? null,
    wilaya: pv.wilaya ?? null,
    address: pv.address ?? null,
  };

  return (
    <DriverInfoManager
      verified={verified}
      vehicle={vehicle}
      documents={documents}
      payouts={(payoutsRaw ?? []) as SelfPayout[]}
      requests={(reqRaw ?? []) as SelfRequest[]}
    />
  );
}
