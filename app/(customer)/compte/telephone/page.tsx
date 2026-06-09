import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidDzPhone } from "@/lib/dz/phone";
import { PhoneGateForm } from "@/components/customer/phone-gate-form";

export const dynamic = "force-dynamic";

function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/compte/telephone")) return "/";
  return raw;
}

/**
 * Page OBLIGATOIRE de saisie du numéro de téléphone. Le middleware y force tout
 * client connecté sans mobile algérien valide (ex. inscription Google). Tant
 * que le numéro n'est pas valide, impossible d'accéder au reste de la plateforme.
 */
export default async function PhoneGatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter");

  const { data: cust } = await supabase
    .from("customers")
    .select("full_name, phone")
    .eq("user_id", user.id)
    .maybeSingle();
  // Pas un client (commerçant) → vers son espace.
  if (!cust) redirect("/dashboard");
  // Numéro déjà valide → rien à faire ici.
  if (isValidDzPhone(cust.phone)) redirect(next);

  return <PhoneGateForm fullName={cust.full_name ?? ""} next={next} />;
}
