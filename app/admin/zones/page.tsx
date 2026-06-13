import { createAdminClient } from "@/lib/supabase/admin";
import { ZonesManager } from "@/components/admin/zones/zones-manager";
import type {
  ServiceDefaultRow,
  ZoneRuleRow,
} from "@/components/admin/zones/types";

export const dynamic = "force-dynamic";

// L'accès super-admin (+ MFA) est garanti par app/admin/layout.tsx.
export default async function AdminZonesPage() {
  const admin = createAdminClient();

  // Tables hors database.types.ts généré (Docker requis) → accès casté.
  type Selectable = {
    select: (c: string) => {
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => {
          limit: (n: number) => Promise<{ data: unknown }>;
        };
      };
      then: (cb: (r: { data: unknown }) => void) => Promise<{ data: unknown }>;
    };
  };
  const from = (n: string) =>
    (admin.from as unknown as (t: string) => Selectable)(n);

  const [{ data: rules }, { data: defaults }] = await Promise.all([
    from("service_zone_rules")
      .select(
        "id, label, service, mode, scope, direction, priority, active, coming_soon, country_code, wilaya_code, commune, center_lat, center_lng, radius_km, polygon, note, created_at"
      )
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(2000),
    from("service_zone_defaults").select(
      "service, default_allow, service_active, max_distance_km"
    ) as unknown as Promise<{ data: unknown }>,
  ]);

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-extrabold">
          Zones & disponibilités
        </h1>
        <p className="text-muted mt-1 text-sm">
          Autorisez ou bloquez chaque service (Express · Tournée · Drive) par
          pays, wilaya, commune, rayon ou périmètre dessiné. Tout est vérifié
          automatiquement à la commande / à la course.
        </p>
      </header>

      <ZonesManager
        rules={(rules ?? []) as ZoneRuleRow[]}
        defaults={(defaults ?? []) as ServiceDefaultRow[]}
      />
    </div>
  );
}
