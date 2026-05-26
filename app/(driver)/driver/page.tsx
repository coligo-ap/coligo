import Link from "next/link";
import { redirect } from "next/navigation";
import { Bolt, Calendar, LogOut, Truck, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { Button } from "@/components/ui/button";
import { driverLogout } from "@/app/(driver)/actions";

export const dynamic = "force-dynamic";

type Link = {
  merchant_driver_id: string;
  status: "pending" | "active" | "blocked";
  merchant: {
    id: string;
    name: string;
    express_enabled: boolean;
    tours_enabled: boolean;
  };
};

export default async function DriverHomePage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  if (driver.is_frozen) {
    return (
      <div className="space-y-3 pt-10 text-center">
        <h1 className="text-xl font-semibold">Compte gelé</h1>
        <p className="text-muted text-sm">
          Ton accès a été suspendu par Coligo. Contacte le support.
        </p>
      </div>
    );
  }

  const { data: links } = await supabase
    .from("merchant_drivers")
    .select(
      "id, status, merchants ( id, name, express_enabled, tours_enabled )"
    )
    .eq("driver_id", driver.id);

  const mapped: Link[] = (links ?? []).flatMap((l) => {
    const m = Array.isArray(l.merchants) ? l.merchants[0] : l.merchants;
    if (!m) return [];
    return [
      {
        merchant_driver_id: l.id,
        status: l.status as Link["status"],
        merchant: {
          id: m.id,
          name: m.name,
          express_enabled: m.express_enabled,
          tours_enabled: m.tours_enabled,
        },
      },
    ];
  });

  const active = mapped.filter((l) => l.status === "active");
  const pending = mapped.filter((l) => l.status === "pending");
  const blocked = mapped.filter((l) => l.status === "blocked");

  return (
    <div className="space-y-5">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Bonjour {driver.full_name.split(" ")[0]}
          </h1>
          <p className="text-muted text-xs">{driver.phone}</p>
        </div>
        <form action={driverLogout}>
          <Button type="submit" size="sm" variant="secondary">
            <LogOut className="size-4" />
          </Button>
        </form>
      </header>

      {/* Ajouter un nouveau commerçant */}
      <Link
        href="/driver/codes"
        className="border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 flex items-center justify-between rounded-[14px] border-2 border-dashed px-4 py-3 text-sm font-semibold"
      >
        + Rejoindre un commerçant (saisir un code)
      </Link>

      <Link
        href="/driver/gains"
        className="border-border bg-surface flex items-center gap-3 rounded-[14px] border px-4 py-3 text-sm font-semibold"
      >
        <Wallet className="text-success-600 size-5" />
        Mes gains & encaissements
      </Link>

      {active.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
            Mes commerçants
          </h2>
          <ul className="space-y-2">
            {active.map((l) => (
              <li key={l.merchant_driver_id}>
                <Link
                  href={`/driver/m/${l.merchant_driver_id}`}
                  className="border-border bg-surface flex items-center gap-3 rounded-[14px] border px-4 py-3"
                >
                  <Truck className="text-primary-600 size-5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {l.merchant.name}
                    </span>
                    <span className="text-muted text-xs">
                      {l.merchant.express_enabled && "Express"}
                      {l.merchant.express_enabled &&
                        l.merchant.tours_enabled &&
                        " · "}
                      {l.merchant.tours_enabled && "Tournée"}
                    </span>
                  </span>
                  <Bolt className="text-warning-500 size-4" />
                  <Calendar className="text-success-600 size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
            En attente de validation
          </h2>
          <ul className="space-y-2">
            {pending.map((l) => (
              <li
                key={l.merchant_driver_id}
                className="border-warning-200 bg-warning-50 text-warning-700 rounded-[14px] border px-4 py-3 text-sm"
              >
                <span className="font-semibold">{l.merchant.name}</span>
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
                key={l.merchant_driver_id}
                className="border-danger-200 bg-danger-50 text-danger-700 rounded-[14px] border px-4 py-3 text-sm"
              >
                <span className="font-semibold">{l.merchant.name}</span>
                <span className="block text-xs">
                  Le commerçant a bloqué ton accès. Resoumets le code si tu en
                  as un nouveau.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mapped.length === 0 && (
        <p className="text-muted text-sm">
          Tu n&apos;es lié à aucun commerçant pour l&apos;instant.
        </p>
      )}
    </div>
  );
}
