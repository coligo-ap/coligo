import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { TourExecution } from "@/components/driver/tour-execution";

export const dynamic = "force-dynamic";

export default async function DriverTourExecutionPage({
  params,
}: {
  params: Promise<{ mdId: string; tourId: string }>;
}) {
  const { mdId, tourId } = await params;
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  const { data: tour } = await supabase
    .from("delivery_tours")
    .select("id, driver_id, status, started_at")
    .eq("id", tourId)
    .maybeSingle();
  if (!tour || tour.driver_id !== driver.id) notFound();

  const { data: stops } = await supabase
    .from("tour_stops")
    .select(
      `id, stop_order, status, delivered_at,
       orders ( id, customer_name, customer_phone, total_da, payment_method,
                delivery_address_text, delivery_phone, delivery_lat, delivery_lng )`
    )
    .eq("tour_id", tourId)
    .order("stop_order", { ascending: true });

  const rows = (stops ?? []).flatMap((s) => {
    const o = Array.isArray(s.orders) ? s.orders[0] : s.orders;
    if (!o) return [];
    return [
      {
        stop_id: s.id,
        stop_order: s.stop_order,
        stop_status: s.status as "pending" | "delivered" | "failed",
        order_id: o.id,
        customer_name: o.customer_name,
        customer_phone: o.customer_phone,
        total_da: o.total_da,
        payment_method: o.payment_method as "cash" | "online",
        delivery_address_text: o.delivery_address_text,
        delivery_phone: o.delivery_phone,
        delivery_lat: o.delivery_lat,
        delivery_lng: o.delivery_lng,
      },
    ];
  });

  return (
    <div className="space-y-4">
      <Link
        href={`/driver/m/${mdId}/tours`}
        className="text-muted inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Créneaux
      </Link>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Tournée en cours</h1>
        <p className="text-muted text-xs">
          {rows.filter((r) => r.stop_status === "delivered").length}/
          {rows.length} livrés
        </p>
      </header>

      <TourExecution stops={rows} />
    </div>
  );
}
