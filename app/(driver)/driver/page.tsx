import Link from "next/link";
import { redirect } from "next/navigation";
import { Bolt, Calendar, ChevronRight, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { DriverDashboardLive } from "@/components/driver/driver-dashboard-live";

export const dynamic = "force-dynamic";

type Counts = {
  merchant_driver_id: string;
  merchant_id: string;
  merchant_name: string;
  express_enabled: boolean;
  tours_enabled: boolean;
  express_available: number;
  tour_pending: number;
};

export default async function DriverHomePage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  const firstName = driver.full_name.split(" ")[0];

  if (driver.is_frozen) {
    return (
      <DriverShell driverFirstName={firstName}>
        <div className="space-y-3 pt-10 text-center">
          <h1 className="text-xl font-semibold">Compte gelé</h1>
          <p className="text-muted text-sm">
            Ton accès a été suspendu par Coligo. Contacte le support.
          </p>
        </div>
      </DriverShell>
    );
  }

  // Compteurs de courses dispo par commerçant (RPC SECURITY DEFINER — la RLS
  // livreur ne voit pas les commandes non attribuées). Déjà trié : commerçant
  // le plus chargé d'abord.
  const { data: countsRaw } = await supabase.rpc("driver_delivery_counts");
  const counts = (countsRaw ?? []) as Counts[];

  // Liens en attente / bloqués (l'actif est couvert par le RPC ci-dessus).
  const { data: links } = await supabase
    .from("merchant_drivers")
    .select("id, status, merchants ( name )")
    .eq("driver_id", driver.id)
    .neq("status", "active");
  const otherLinks = (links ?? []).map((l) => {
    const m = Array.isArray(l.merchants) ? l.merchants[0] : l.merchants;
    return {
      id: l.id,
      status: l.status as "pending" | "blocked",
      name: m?.name ?? "Commerçant",
    };
  });
  const pending = otherLinks.filter((l) => l.status === "pending");
  const blocked = otherLinks.filter((l) => l.status === "blocked");

  // Sections : Express et Tournée, triées par nombre de courses décroissant.
  const expressMerchants = counts
    .filter((c) => c.express_enabled)
    .sort((a, b) => b.express_available - a.express_available);
  const tourMerchants = counts
    .filter((c) => c.tours_enabled)
    .sort((a, b) => b.tour_pending - a.tour_pending);

  const totalExpress = counts.reduce((s, c) => s + c.express_available, 0);
  const totalTour = counts.reduce((s, c) => s + c.tour_pending, 0);

  return (
    <DriverShell driverFirstName={firstName}>
      {/* Alerte temps réel : refresh des compteurs + toast à chaque nouvelle
          livraison chez l'un de ses commerçants. */}
      <DriverDashboardLive />

      <div className="space-y-5">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Bonjour {firstName}
            </h1>
            <p className="text-muted text-xs">{driver.phone}</p>
          </div>
          <Link
            href="/driver/gains"
            className="border-border bg-surface inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold"
          >
            <Wallet className="text-success-600 size-4" />
            Gains
          </Link>
        </header>

        {counts.length === 0 ? (
          <Link
            href="/driver/codes"
            className="border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 flex items-center justify-between rounded-[14px] border-2 border-dashed px-4 py-3 text-sm font-semibold"
          >
            + Rejoindre un commerçant (saisir un code)
          </Link>
        ) : (
          <>
            {/* ===================== EXPRESS ===================== */}
            <SectionHeader
              icon={<Bolt className="text-warning-500 size-5" />}
              title="Express"
              count={totalExpress}
              tone="warning"
            />
            {expressMerchants.length === 0 ? (
              <EmptyCard text="Aucun commerçant avec l'Express activé." />
            ) : (
              <ul className="space-y-2">
                {expressMerchants.map((c) => (
                  <li key={`ex-${c.merchant_driver_id}`}>
                    <DeliveryRow
                      href={`/driver/m/${c.merchant_driver_id}`}
                      name={c.merchant_name}
                      count={c.express_available}
                      label={
                        c.express_available > 0 ? "à récupérer" : "en attente"
                      }
                      tone="warning"
                      icon={<Bolt className="text-warning-500 size-4" />}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/* ===================== TOURNÉE ===================== */}
            <SectionHeader
              icon={<Calendar className="text-success-600 size-5" />}
              title="Tournée"
              count={totalTour}
              tone="success"
            />
            {tourMerchants.length === 0 ? (
              <EmptyCard text="Aucun commerçant avec les tournées activées." />
            ) : (
              <ul className="space-y-2">
                {tourMerchants.map((c) => (
                  <li key={`tr-${c.merchant_driver_id}`}>
                    <DeliveryRow
                      href={`/driver/m/${c.merchant_driver_id}/tours`}
                      name={c.merchant_name}
                      count={c.tour_pending}
                      label={c.tour_pending > 0 ? "à livrer" : "aucune"}
                      tone="success"
                      icon={<Calendar className="text-success-600 size-4" />}
                    />
                  </li>
                ))}
              </ul>
            )}

            <Link
              href="/driver/codes"
              className="border-primary-300 bg-primary-50/60 text-primary-700 hover:bg-primary-100 flex items-center justify-center rounded-[14px] border-2 border-dashed px-4 py-2.5 text-sm font-semibold"
            >
              + Rejoindre un autre commerçant
            </Link>
          </>
        )}

        {pending.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
              En attente de validation
            </h2>
            <ul className="space-y-2">
              {pending.map((l) => (
                <li
                  key={l.id}
                  className="border-warning-200 bg-warning-50 text-warning-700 rounded-[14px] border px-4 py-3 text-sm"
                >
                  <span className="font-semibold">{l.name}</span>
                  <span className="block text-xs">
                    Le commerçant doit valider ta demande.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {blocked.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-danger-600 text-xs font-semibold tracking-wide uppercase">
              Accès retirés
            </h2>
            <ul className="space-y-2">
              {blocked.map((l) => (
                <li
                  key={l.id}
                  className="border-danger-200 bg-danger-50 text-danger-700 rounded-[14px] border px-4 py-3 text-sm"
                >
                  <span className="font-semibold">{l.name}</span>
                  <span className="block text-xs">
                    Le commerçant a bloqué ton accès. Resoumets le code si tu en
                    as un nouveau.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DriverShell>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  tone: "warning" | "success";
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2">
      <h2 className="text-foreground flex items-center gap-2 text-base font-bold">
        {icon}
        {title}
      </h2>
      <span
        className={
          "inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold " +
          (tone === "warning"
            ? "bg-warning-100 text-warning-700"
            : "bg-success-100 text-success-700")
        }
      >
        {count} course{count > 1 ? "s" : ""}
      </span>
    </div>
  );
}

function DeliveryRow({
  href,
  name,
  count,
  label,
  tone,
  icon,
}: {
  href: string;
  name: string;
  count: number;
  label: string;
  tone: "warning" | "success";
  icon: React.ReactNode;
}) {
  const active = count > 0;
  return (
    <Link
      href={href}
      className={
        "flex items-center gap-3 rounded-[14px] border px-4 py-3 transition " +
        (active
          ? tone === "warning"
            ? "border-warning-300 bg-warning-50"
            : "border-success-300 bg-success-50"
          : "border-border bg-surface")
      }
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="text-muted text-xs">
          {count} {label}
        </span>
      </span>
      {active && (
        <span
          className={
            "inline-flex size-7 items-center justify-center rounded-full text-sm font-bold text-white " +
            (tone === "warning" ? "bg-warning-500" : "bg-success-600")
          }
        >
          {count}
        </span>
      )}
      <ChevronRight className="text-muted size-4" />
    </Link>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <p className="border-border bg-surface text-muted rounded-[14px] border px-4 py-3 text-xs">
      {text}
    </p>
  );
}
