import { Users } from "lucide-react";
import { AdminHubTabs } from "@/components/admin/admin-hub-tabs";
import { requireAdminDomain } from "@/lib/auth/admin";

/**
 * Hub CLIENTS — annuaire, suspension de compte et coupure ciblée de
 * fonctionnalités. Gate de domaine ici (le gate super-admin global vit dans
 * app/admin/layout.tsx) ; les pages gardent leur propre conteneur.
 */
export default async function ClientsHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminDomain("clients");
  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-4 lg:px-6">
          <div className="mb-3 flex items-center gap-2">
            <Users className="size-5" />
            <h1 className="text-lg font-bold tracking-tight">Clients</h1>
          </div>
          <div className="pb-2">
            <AdminHubTabs domain="clients" />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
