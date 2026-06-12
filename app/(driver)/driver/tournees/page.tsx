import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";

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

/**
 * Hub TOURNÉES côté livreur — le point d'entrée qui manquait : rejoindre un
 * commerçant (code) + liste des commerçants rejoints pour démarrer une tournée.
 * L'Express, lui, arrive tout seul depuis l'accueil quand le livreur est en
 * ligne (pas besoin de passer ici).
 */
export default async function DriverToursHubPage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // Commerçants ACTIFS (avec compteur de commandes en tournée), RPC déjà trié.
  const { data: countsRaw } = await supabase.rpc("driver_delivery_counts");
  const active = ((countsRaw ?? []) as Counts[]).filter((c) => c.tours_enabled);

  // Tous les liens — pour la commune (affichage) et les statuts pending/bloqué.
  const { data: linksRaw } = await supabase
    .from("merchant_drivers")
    .select("id, status, merchants ( name, commune )")
    .eq("driver_id", driver.id);

  type MInfo = { name: string; commune: string | null };
  type LinkRow = {
    id: string;
    status: string;
    merchants: MInfo | MInfo[] | null;
  };
  const links = (linksRaw ?? []) as LinkRow[];
  const one = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;
  const communeOf = new Map(
    links.map((l) => [l.id, one(l.merchants)?.commune ?? null])
  );

  const pending = links
    .filter((l) => l.status === "pending")
    .map((l) => ({ id: l.id, name: one(l.merchants)?.name ?? "Commerçant" }));
  const blocked = links
    .filter((l) => l.status === "blocked")
    .map((l) => ({ id: l.id, name: one(l.merchants)?.name ?? "Commerçant" }));

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="space-y-5">
        <header className="space-y-1">
          <h1 className="text-[18px] font-bold tracking-tight text-[#0a0a0a]">
            Tournées
          </h1>
          <p className="text-sm font-medium text-[#757575]">
            Rejoins un commerçant avec son code, puis démarre ses tournées. (Les
            courses Express, elles, arrivent toutes seules depuis l&apos;accueil
            quand tu es en ligne.)
          </p>
        </header>

        {/* Rejoindre un commerçant — toujours accessible */}
        <Link
          href="/driver/codes"
          className="flex items-center gap-3 rounded-[14px] border-2 border-dashed border-[#d8d8f0] bg-[#f4f4fb] px-4 py-3.5 active:scale-[0.99]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-[#4b1fa6]">
            <KeyRound className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-[#4b1fa6]">
              Rejoindre un commerçant
            </span>
            <span className="block text-xs font-medium text-[#7a6aa8]">
              Saisis le code que le commerçant t&apos;a partagé.
            </span>
          </span>
          <ChevronRight className="size-[18px] text-[#9e9e9e]" />
        </Link>

        {/* Commerçants rejoints (actifs) */}
        {active.length > 0 && (
          <section className="space-y-2">
            <p className="px-1 text-[11px] font-bold tracking-wide text-[#9e9e9e] uppercase">
              Mes commerçants
            </p>
            <ul className="space-y-2.5">
              {active.map((m) => {
                const commune = communeOf.get(m.merchant_driver_id);
                return (
                  <li key={m.merchant_driver_id}>
                    <Link
                      href={`/driver/m/${m.merchant_driver_id}`}
                      className="flex items-center gap-3 rounded-[12px] border border-[#eee] bg-white px-3.5 py-3 active:scale-[0.99]"
                    >
                      <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-[#f5f5f5] text-sm font-extrabold text-[#0a0a0a]">
                        {m.merchant_name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-[#0a0a0a]">
                          {m.merchant_name}
                        </span>
                        <span className="text-xs font-medium text-[#757575]">
                          {commune ? `${commune} · ` : ""}
                          {m.tour_pending > 0
                            ? `${m.tour_pending} commande${m.tour_pending > 1 ? "s" : ""} en tournée`
                            : "Aucune commande en attente"}
                        </span>
                      </span>
                      {m.tour_pending > 0 && (
                        <span className="grid size-6 place-items-center rounded-full bg-[#0a0a0a] text-xs font-bold text-white">
                          {m.tour_pending}
                        </span>
                      )}
                      <ChevronRight className="size-[18px] text-[#9e9e9e]" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Demandes en attente / accès retirés */}
        {(pending.length > 0 || blocked.length > 0) && (
          <div className="space-y-2">
            {pending.map((l) => (
              <div
                key={l.id}
                className="rounded-[12px] border border-[#F5E0A1] bg-[#FFF8E5] px-3.5 py-2.5 text-xs font-medium text-[#8B6500]"
              >
                <b className="font-bold">{l.name}</b> · en attente de validation
                du commerçant.
              </div>
            ))}
            {blocked.map((l) => (
              <div
                key={l.id}
                className="rounded-[12px] border border-[#f5c6c2] bg-[#FFF3F2] px-3.5 py-2.5 text-xs font-medium text-[#B22A1F]"
              >
                <b className="font-bold">{l.name}</b> · accès retiré. Resoumets
                un code si tu en as un nouveau.
              </div>
            ))}
          </div>
        )}

        {active.length === 0 &&
          pending.length === 0 &&
          blocked.length === 0 && (
            <p className="px-1 text-sm font-medium text-[#9e9e9e]">
              Tu n&apos;as encore rejoint aucun commerçant. Saisis un code
              ci-dessus pour commencer à faire des tournées.
            </p>
          )}
      </div>
    </DriverShell>
  );
}
