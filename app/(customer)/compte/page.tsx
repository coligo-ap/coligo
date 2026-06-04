import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronRight,
  Gift,
  Heart,
  Mail,
  Phone,
  Receipt,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { CustomerLogoutButton } from "@/components/customer/logout-button";
import {
  getMyCashbackBalance,
  getMyTopupBalance,
} from "@/lib/customer/cashback";
import { WILAYAS } from "@/lib/config/wilayas";
import { formatDA } from "@/lib/utils";

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

  const [cashbackBalance, topupBalance] = await Promise.all([
    getMyCashbackBalance(),
    getMyTopupBalance(),
  ]);

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

        {/* Raccourcis : Cashback / Coligo Pay / Commandes — chacun DISTINCT. */}
        <ul className="mb-4 space-y-2">
          <li>
            <Link
              href="/cashback"
              className="border-border bg-surface hover:border-primary-300 group flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
            >
              <div className="bg-primary-100 text-primary-700 flex size-11 shrink-0 items-center justify-center rounded-full">
                <Gift className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  Mon Cashback
                </p>
                <p className="text-muted text-xs">
                  Récompense non retirable ·{" "}
                  <span className="text-primary-700 font-bold tabular-nums">
                    {formatDA(cashbackBalance)}
                  </span>
                </p>
              </div>
              <ChevronRight className="text-muted size-4" />
            </Link>
          </li>
          <li>
            <Link
              href="/coligo-pay"
              className="border-border bg-surface hover:border-primary-300 group flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
            >
              <div className="bg-primary-50 text-primary-700 flex size-11 shrink-0 items-center justify-center rounded-full">
                <Wallet className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  Coligo Pay
                </p>
                <p className="text-muted text-xs">
                  Solde réel rechargeable ·{" "}
                  <span className="text-primary-700 font-bold tabular-nums">
                    {formatDA(topupBalance)}
                  </span>
                </p>
              </div>
              <ChevronRight className="text-muted size-4" />
            </Link>
          </li>
          <li>
            <Link
              href="/commandes"
              className="border-border bg-surface hover:border-primary-300 group flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
            >
              <div className="bg-primary-50 text-primary-700 flex size-11 shrink-0 items-center justify-center rounded-full">
                <Receipt className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  Mes commandes
                </p>
                <p className="text-muted text-xs">
                  Historique et suivi en cours
                </p>
              </div>
              <ChevronRight className="text-muted size-4" />
            </Link>
          </li>
          <li>
            <Link
              href="/favoris"
              className="border-border bg-surface hover:border-primary-300 group flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
            >
              <div className="bg-coral-50 text-coral-600 flex size-11 shrink-0 items-center justify-center rounded-full">
                <Heart className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  Mes favoris
                </p>
                <p className="text-muted text-xs">
                  Tes commerces préférés, en accès rapide
                </p>
              </div>
              <ChevronRight className="text-muted size-4" />
            </Link>
          </li>
        </ul>

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

        <CustomerLogoutButton />

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
