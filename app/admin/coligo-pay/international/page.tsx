import { createAdminClient } from "@/lib/supabase/admin";
import { getIntlSettings, resolveEffectiveRate } from "@/lib/payments/intl";
import { stripeKeysPresence } from "@/lib/payments/stripe";
import { IntlPaymentsManager } from "@/components/admin/intl-payments-manager";

export const dynamic = "force-dynamic";

// =============================================================================
// /admin/coligo-pay/international — pilotage des paiements en euros (diaspora)
// Domaine finances (garde RBAC au layout coligo-pay). Lectures service_role
// AUTO-GARDÉES par ce même layout (requireAdminDomain).
// =============================================================================

type SessionRow = {
  id: string;
  eur_cents: number;
  total_da: number;
  rate_da: number;
  rate_source: string;
  ip_country: string | null;
  status: string;
  created_at: string;
  order_id: string;
};

type AuditRow = {
  action: string;
  note: string | null;
  created_at: string;
};

export default async function AdminIntlPaymentsPage() {
  const admin = createAdminClient();

  const sessionsQ = admin.from("intl_payment_sessions" as never) as unknown as {
    select: (cols: string) => {
      order: (
        c: string,
        o: { ascending: boolean }
      ) => { limit: (n: number) => Promise<{ data: SessionRow[] | null }> };
    };
  };
  const snapshotsQ = admin.from("intl_rate_snapshots" as never) as unknown as {
    select: (cols: string) => {
      order: (
        c: string,
        o: { ascending: boolean }
      ) => {
        limit: (n: number) => Promise<{
          data:
            | {
                source: string;
                raw_rate_da: number | null;
                ok: boolean;
                note: string | null;
                fetched_at: string;
              }[]
            | null;
        }>;
      };
    };
  };
  const waitlistQ = admin.from(
    "intl_capacity_waitlist" as never
  ) as unknown as {
    select: (
      cols: string,
      opts: { count: "exact"; head: true }
    ) => { is: (c: string, v: null) => Promise<{ count: number | null }> };
  };

  const settings = await getIntlSettings(admin);
  const [rate, sessionsRes, snapshotsRes, waitlistRes, usageRes, auditRes] =
    await Promise.all([
      // Jamais de fetch réseau au rendu de la page (bouton dédié pour ça).
      resolveEffectiveRate(admin, settings, { networkFetch: false }),
      sessionsQ
        .select(
          "id, eur_cents, total_da, rate_da, rate_source, ip_country, status, created_at, order_id"
        )
        .order("created_at", { ascending: false })
        .limit(30),
      snapshotsQ
        .select("source, raw_rate_da, ok, note, fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(8),
      waitlistQ
        .select("customer_id", { count: "exact", head: true })
        .is("notified_at", null),
      (
        admin.rpc.bind(admin) as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ data: unknown }>
      )("intl_caps_usage", {
        p_customer: "00000000-0000-0000-0000-000000000000",
      }),
      admin
        .from("admin_audit_log")
        .select("action, note, created_at")
        .in("action", [
          "intl_settings_update",
          "intl_capacity_block",
          "intl_webhook_sig_fail",
          "intl_amount_mismatch",
          "intl_session_mismatch",
          "intl_refunded",
          "intl_waitlist_notified",
          "paid_after_cancel",
        ])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const usage = (
    Array.isArray(usageRes.data) ? usageRes.data[0] : usageRes.data
  ) as {
    platform_day_cents: number;
    platform_month_cents: number;
  } | null;

  return (
    <IntlPaymentsManager
      settings={settings}
      effectiveRate={rate}
      keys={stripeKeysPresence()}
      usage={{
        platform_day_cents: Number(usage?.platform_day_cents ?? 0),
        platform_month_cents: Number(usage?.platform_month_cents ?? 0),
      }}
      sessions={sessionsRes.data ?? []}
      snapshots={snapshotsRes.data ?? []}
      waitlistCount={waitlistRes.count ?? 0}
      audit={(auditRes.data ?? []) as AuditRow[]}
    />
  );
}
