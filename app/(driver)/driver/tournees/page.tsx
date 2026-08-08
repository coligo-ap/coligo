import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ChevronRight, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PartnerEmptyState } from "@/components/shared/partner-ui";

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
  // Fonctionnalité réservée aux comptes vérifiés par l'équipe Coligo :
  // un livreur en cours d'inscription est renvoyé à son étape du parcours.
  await requireActiveDriver();
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

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
    .map((l) => ({
      id: l.id,
      name: one(l.merchants)?.name ?? tr("Commerçant", "التاجر"),
    }));
  const blocked = links
    .filter((l) => l.status === "blocked")
    .map((l) => ({
      id: l.id,
      name: one(l.merchants)?.name ?? tr("Commerçant", "التاجر"),
    }));

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="space-y-5">
        <header className="space-y-1.5">
          <h1 className="mq-sora text-display font-extrabold tracking-[-0.5px] text-[var(--ink)]">
            {tr("Tournées", "الجولات")}
          </h1>
          <p className="text-sm font-medium text-[var(--muted)]">
            {tr(
              "Rejoins un commerçant avec son code, puis démarre ses tournées. (Les courses Express, elles, arrivent toutes seules depuis l'accueil quand tu es en ligne.)",
              "انضم إلى تاجر برمزه، ثم ابدأ جولاته. (أما توصيلات إكسبرس فتصلك تلقائيًا من الشاشة الرئيسية عندما تكون متصلًا.)"
            )}
          </p>
        </header>

        {/* Rejoindre un commerçant — toujours accessible */}
        <Link
          href="/driver/codes"
          className="rounded-card-lg flex items-center gap-3 border-2 border-dashed border-[var(--violet-l)] bg-[var(--violet-soft)] px-4 py-3.5 transition-transform active:scale-[0.99]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[var(--violet)]">
            <KeyRound className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-[var(--violet-d)]">
              {tr("Rejoindre un commerçant", "الانضمام إلى تاجر")}
            </span>
            <span className="block text-xs font-medium text-[var(--violet)]/80">
              {tr(
                "Saisis le code que le commerçant t'a partagé.",
                "أدخل الرمز الذي شاركه معك التاجر."
              )}
            </span>
          </span>
          <ChevronRight className="size-[18px] text-[var(--violet)] rtl:rotate-180" />
        </Link>

        {/* Commerçants rejoints (actifs) */}
        {active.length > 0 && (
          <section className="space-y-2">
            <p className="text-caption px-1 font-bold tracking-wide text-[var(--muted)] uppercase">
              {tr("Mes commerçants", "تجّاري")}
            </p>
            <ul className="space-y-2.5">
              {active.map((m) => {
                const commune = communeOf.get(m.merchant_driver_id);
                return (
                  <li key={m.merchant_driver_id}>
                    <Link
                      href={`/driver/m/${m.merchant_driver_id}`}
                      className="rounded-card-lg flex items-center gap-3 border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3 transition-transform active:scale-[0.99]"
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
                            ? isAr
                              ? `${m.tour_pending} طلبية في الجولة`
                              : `${m.tour_pending} commande${m.tour_pending > 1 ? "s" : ""} en tournée`
                            : tr(
                                "Aucune commande en attente",
                                "لا طلبيات في الانتظار"
                              )}
                        </span>
                      </span>
                      {m.tour_pending > 0 && (
                        <span className="grid size-6 place-items-center rounded-full bg-[var(--violet)] text-xs font-bold text-white">
                          {m.tour_pending}
                        </span>
                      )}
                      <ChevronRight className="size-[18px] text-[var(--muted)] rtl:rotate-180" />
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
                className="rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.12)] px-3.5 py-2.5 text-xs font-medium text-[var(--amber)]"
              >
                <b className="font-bold">{l.name}</b> ·{" "}
                {tr(
                  "en attente de validation du commerçant.",
                  "في انتظار مصادقة التاجر."
                )}
              </div>
            ))}
            {blocked.map((l) => (
              <div
                key={l.id}
                className="rounded-md border border-[rgba(229,72,77,0.3)] bg-[var(--red-soft)] px-3.5 py-2.5 text-xs font-medium text-[var(--red)]"
              >
                <b className="font-bold">{l.name}</b> ·{" "}
                {tr(
                  "accès retiré. Resoumets un code si tu en as un nouveau.",
                  "سُحب الوصول. أعد إدخال رمز إذا كان لديك رمز جديد."
                )}
              </div>
            ))}
          </div>
        )}

        {active.length === 0 &&
          pending.length === 0 &&
          blocked.length === 0 && (
            <PartnerEmptyState
              icon={<KeyRound className="size-5" />}
              title={tr("Aucun commerçant rejoint", "لم تنضم إلى أي تاجر")}
              text={tr(
                "Saisis un code ci-dessus pour commencer à faire des tournées.",
                "أدخل رمزًا أعلاه لتبدأ في القيام بالجولات."
              )}
            />
          )}
      </div>
    </DriverShell>
  );
}
