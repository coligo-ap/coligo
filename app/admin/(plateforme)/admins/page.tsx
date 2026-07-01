import { ShieldPlus } from "lucide-react";
import { requireOwner } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AdminsManager,
  type AdminRow,
} from "@/components/admin/admins/admins-manager";

export const dynamic = "force-dynamic";

// Gestion des super-admins (OWNER-ONLY). requireOwner() re-gate ici (un staff
// est renvoyé sur son domaine) en plus du filtrage de l'onglet dans le hub.
export default async function AdminsPage() {
  await requireOwner();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const selfEmail = user?.email?.toLowerCase() ?? "";

  const admin = createAdminClient();
  // Colonnes RBAC (mig 0301) hors database.types → lecture via cast souple.
  const { data } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        order: (
          c: string,
          o: { ascending: boolean }
        ) => Promise<{ data: AdminRow[] | null }>;
      };
    }
  )("platform_admins")
    .select("email, label, role, domains, is_active, created_by, created_at")
    .order("created_at", { ascending: true });

  const admins = (data ?? []).map((a) => ({
    ...a,
    domains: a.domains ?? [],
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
      <header className="flex items-center gap-2">
        <ShieldPlus className="size-6" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Administrateurs</h1>
          <p className="text-muted text-sm">
            Créez des sous-administrateurs et attribuez-leur des domaines. Un
            owner a accès à tout ; un staff n&apos;accède qu&apos;à ses
            domaines.
          </p>
        </div>
      </header>
      <AdminsManager admins={admins} selfEmail={selfEmail} />
    </div>
  );
}
