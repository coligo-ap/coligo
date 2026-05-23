import { redirect } from "next/navigation";
import { LogOut, Mail, Phone, User as UserIcon } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { customerLogout } from "@/app/(customer)/actions";
import { WILAYAS } from "@/lib/config/wilayas";

export const dynamic = "force-dynamic";

export default async function CustomerAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter");

  // Si c'est un commerçant connecté qui tape /compte par erreur → /dashboard.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  const { data: customer } = await supabase
    .from("customers")
    .select("full_name, phone, email, default_wilaya_code, default_commune")
    .eq("user_id", user.id)
    .maybeSingle();

  const wilayaName = customer?.default_wilaya_code
    ? WILAYAS.find((w) => w.code === customer.default_wilaya_code)?.name
    : null;

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 py-6 lg:px-6 lg:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Mon compte
          </h1>
          <p className="text-muted mt-1 text-sm">
            Tes informations personnelles et tes préférences.
          </p>
        </header>

        <div className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
          <Row icon={UserIcon} label="Nom complet">
            {customer?.full_name ?? "—"}
          </Row>
          <Row icon={Mail} label="Email">
            {user.email ?? "—"}
          </Row>
          <Row icon={Phone} label="Téléphone">
            {customer?.phone ?? "—"}
          </Row>
          <Row icon={UserIcon} label="Zone préférée">
            {wilayaName
              ? `${wilayaName}${customer?.default_commune ? ` · ${customer.default_commune}` : ""}`
              : "—"}
          </Row>
        </div>

        <form action={customerLogout} className="mt-6">
          <button
            type="submit"
            className="border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 hover:border-danger-300 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border text-sm font-semibold transition-colors"
          >
            <LogOut className="size-4" />
            Déconnexion
          </button>
        </form>

        <p className="text-subtle mt-6 text-center text-xs">
          La gestion fine du profil arrive bientôt (modifier nom, téléphone, mot
          de passe).
        </p>
      </div>
    </CustomerShell>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="text-muted mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-muted text-xs">{label}</p>
        <p className="text-foreground text-sm font-medium">{children}</p>
      </div>
    </div>
  );
}
