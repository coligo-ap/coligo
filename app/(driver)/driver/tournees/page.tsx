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
        <header className="space-y-1.5">
          <h1 className="mq-sora text-[22px] font-extrabold tracking-[-0.5px] text-[var(--ink)]">
            Tournées
          </h1>
          <p className="text-sm font-medium text-[var(--muted)]">
            Rejoins un commerçant avec son code, puis démarre ses tournées. (Les
            courses Express, elles, arrivent toutes seules depuis l&apos;accueil
            quand tu es en ligne.)
          </p>
        </header>

        {/* Rejoindre un commerçant — toujours accessible */}
        <Link
          href="/driver/codes"
          className="flex items-center gap-3 rounded-[14px] border-2 border-dashed border-[var(--violet-l)] bg-[var(--violet-soft)] px-4 py-3.5 transition-transform active:scale-[0.99]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[var(--violet)] shadow-sm">
            <KeyRound className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-[var(--violet-d)]">
              Rejoindre un commerçant
            </span>
            <span className="block text-xs font-medium text-[var(--violet)]/80">
              Saisis le code que le commerçant t&apos;a partagé.
            </span>
          </span>
          <ChevronRight className="size-[18px] text-[var(--violet)]" />
        </Link>

        {/* Commerçants rejoints (actifs) */}
        {active.length > 0 && (
          <section className="space-y-2">
            <p className="px-1 text-[11px] font-bold tracking-wide text-[var(--muted)] uppercase">
              Mes commerçants
            </p>
            <ul className="space-y-2.5">
              {active.map((m) => {
                const commune = communeOf.get(m.merchant_driver_id);
                return (
                  <li key={m.merchant_driver_id}>
                    <Link
                      href={`/driver/m/${m.merchant_driver_id}`}
                      className="flex items-center gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3 shadow-[0_4px_16px_rgba(0,0,0,.04)] transition-transform active:scale-[0.99]"
                    >
                      <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-[var(--soft)] text-sm font-extrabold text-[var(--ink)]">
                        {m.merchant_name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-[var(--ink)]">
                          {m.merchant_name}
                        </span>
                        <span className="text-xs font-medium text-[var(--muted)]">
                          {commune ? `${commune} · ` : ""}
                          {m.tour_pending > 0
                            ? `${m.tour_pending} commande${m.tour_pending > 1 ? "s" : ""} en tournée`
                            : "Aucune commande en attente"}
                        </span>
                      </span>
                      {m.tour_pending > 0 && (
                        <span className="grid size-6 place-items-center rounded-full bg-[var(--violet)] text-xs font-bold text-white">
                          {m.tour_pending}
                        </span>
                      )}
                      <ChevronRight className="size-[18px] text-[var(--muted)]" />
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
                className="rounded-[12px] border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.12)] px-3.5 py-2.5 text-xs font-medium text-[var(--amber)]"
              >
                <b className="font-bold">{l.name}</b> · en attente de validation
                du commerçant.
              </div>
            ))}
            {blocked.map((l) => (
              <div
                key={l.id}
                className="rounded-[12px] border border-[rgba(229,72,77,0.3)] bg-[var(--red-soft)] px-3.5 py-2.5 text-xs font-medium text-[var(--red)]"
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
            <div className="rounded-[16px] border border-[var(--line)] bg-[var(--soft)] px-4 py-8 text-center">
              <span className="mx-auto mb-2 grid size-11 place-items-center rounded-full bg-[var(--surface)] text-[var(--violet)] shadow-sm">
                <KeyRound className="size-5" />
              </span>
              <p className="text-sm font-medium text-[var(--muted)]">
                Tu n&apos;as encore rejoint aucun commerçant. Saisis un code
                ci-dessus pour commencer à faire des tournées.
              </p>
            </div>
          )}
      </div>
    </DriverShell>
  );
}
