import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getConfigRegistry } from "@/lib/data/config-registry";
import { ConfigEditor } from "@/components/admin/config-editor";

export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  if (!(await isSuperAdmin())) redirect("/admin");
  const items = await getConfigRegistry();

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted mt-1 text-sm">
          Paramètres financiers et opérationnels éditables sans développeur.
          Chaque changement est historisé.
        </p>
      </header>
      <ConfigEditor items={items} />
    </div>
  );
}
