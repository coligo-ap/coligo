import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { isValidContactPhone } from "@/lib/dz/phone";
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
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter");

  const cust = await getCurrentCustomerFull();
  // Pas un client (commerçant) → vers son espace.
  if (!cust) redirect("/dashboard");
  // Numéro déjà valide → rien à faire ici.
  if (isValidContactPhone(cust.phone)) redirect(next);

  return (
    <PhoneGateForm
      fullName={cust.full_name ?? ""}
      email={cust.email ?? user.email ?? ""}
      next={next}
    />
  );
}
