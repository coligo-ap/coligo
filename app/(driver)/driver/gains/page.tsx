import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { createClient } from "@/lib/supabase/server";
import {
  getDriverFirstActivityMonth,
  getDriverSettlement,
  parseSettlementPeriod,
} from "@/lib/driver/settlement-data";
import { DriverShell } from "@/components/driver/driver-shell";
import { GainsReleveView } from "@/components/partner/gains-releve";
import { RelevePeriodPicker } from "@/components/driver/releve/period-picker";

export const dynamic = "force-dynamic";

type Claim = {
  id: string;
  order_id: string;
  advance_da: number;
  status: "pending" | "approved" | "rejected";
  goods_decision: "return_to_merchant" | "driver_keeps" | "give_away" | null;
  admin_note: string | null;
  created_at: string;
};

/**
 * « GAINS ET RELEVÉS » — page UNIQUE (style Bolt) qui fusionne l'ancien volet
 * Gains et l'ancienne page /driver/releve : net + commission Coligo, filtre
 * paiement (Tous · Espèces · En ligne), verdict de versement + PDF. Les
 * montants viennent de `getDriverSettlement` (SOURCE UNIQUE partagée avec le
 * PDF /api/pdf/releve). Le gain du jour vit sur l'accueil (zéro doublon).
 */
export default async function DriverGainsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  // Fonctionnalité réservée aux comptes vérifiés par l'équipe Coligo :
  // un livreur en cours d'inscription est renvoyé à son étape du parcours.
  await requireActiveDriver();
  const params = await searchParams;
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // Période demandée (?month= / ?from=&to=) — même interprétation que le PDF.
  const period = parseSettlementPeriod(params);

  // Relevé (source partagée) + borne du sélecteur + réclamations no-show.
  const [data, firstMonth, claimsRes] = await Promise.all([
    getDriverSettlement(driver.id, period),
    getDriverFirstActivityMonth(driver.id),
    supabase
      .from("driver_refund_claims")
      .select(
        "id, order_id, advance_da, status, goods_decision, admin_note, created_at"
      )
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // Le PDF reprend EXACTEMENT la période affichée.
  const pdfQuery = params.month
    ? `?month=${params.month}`
    : params.from && params.to
      ? `?from=${params.from}&to=${params.to}`
      : "";

  const claims = (claimsRes.data ?? []) as Claim[];
  const isAr = (await getLocale()) === "ar";

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <GainsReleveView
        base="/driver"
        periodLabel={data.periodLabel}
        slices={data.byMethod}
        verdict={{
          direction: data.direction,
          amountDa: data.netDa,
          dueLabel: data.dueLabel,
        }}
        pdfHref={`/api/pdf/releve${pdfQuery}`}
        periodPicker={
          <RelevePeriodPicker
            basePath="/driver/gains"
            firstMonth={firstMonth}
            selectedMonth={params.month ?? null}
            customFrom={params.from ?? null}
            customTo={params.to ?? null}
          />
        }
      >
        {claims.length > 0 && <ClaimsSection claims={claims} isAr={isAr} />}
      </GainsReleveView>
    </DriverShell>
  );
}

/**
 * Réclamations d'avance no-show (mig 0160) : l'avance payée au commerçant au
 * pickup d'une commande COD finie en no-show n'est remboursée qu'après
 * validation du support, qui décide aussi du sort de la marchandise.
 */
function ClaimsSection({ claims, isAr }: { claims: Claim[]; isAr: boolean }) {
  return (
    <section className="mb-3 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--d-ink)]">
        {isAr
          ? "سلفات عدم الاستلام (مصادقة الدعم)"
          : "Avances no-show (validation support)"}
      </h2>
      <ul className="mt-2 space-y-3">
        {claims.map((c) => (
          <li key={c.id} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold tabular-nums">
                {c.advance_da.toLocaleString("fr-FR").replace(/ /g, " ")}{" "}
                {isAr ? "دج" : "DA"}
              </span>
              <ClaimBadge status={c.status} isAr={isAr} />
            </div>
            <p className="mt-0.5 text-xs text-[var(--d-muted)]">
              {claimMessage(c, isAr)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClaimBadge({
  status,
  isAr,
}: {
  status: Claim["status"];
  isAr: boolean;
}) {
  const map = {
    pending: [
      isAr ? "في انتظار الدعم" : "En attente du support",
      "bg-amber-50 text-amber-700",
    ],
    approved: [
      isAr ? "مصادَق عليها" : "Validée",
      "bg-emerald-50 text-emerald-700",
    ],
    rejected: [isAr ? "مرفوضة" : "Refusée", "bg-rose-50 text-rose-700"],
  } as const;
  const [label, cls] = map[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function claimMessage(c: Claim, isAr: boolean): string {
  if (c.status === "pending") {
    return isAr
      ? "يتحقق الدعم من سلفتك وسيقرر مصير الطلبية (إرجاع، احتفاظ أو تبرّع)."
      : "Le support vérifie votre avance et décidera du sort de la commande (retour, garder ou donner).";
  }
  if (c.status === "rejected") {
    return c.admin_note
      ? isAr
        ? `رفضها الدعم: ${c.admin_note}`
        : `Refusée par le support : ${c.admin_note}`
      : isAr
        ? "رفضها الدعم — تواصل مع المساعدة إذا لزم الأمر."
        : "Refusée par le support — contactez l'aide si besoin.";
  }
  switch (c.goods_decision) {
    case "return_to_merchant":
      return isAr
        ? "أعد الطلبية إلى التاجر: سيسلّمك السلفة يدًا بيد."
        : "Retournez la commande au commerçant : il vous rend l'avance en main propre.";
    case "driver_keeps":
      return isAr
        ? "تحتفظ بالطلبية — تُضاف السلفة إلى كشفك."
        : "Vous gardez la commande — l'avance est créditée sur votre relevé.";
    case "give_away":
      return isAr
        ? "طلبية للتبرّع — تُضاف السلفة إلى كشفك."
        : "Commande à donner — l'avance est créditée sur votre relevé.";
    default:
      return isAr ? "صادق عليها الدعم." : "Validée par le support.";
  }
}
