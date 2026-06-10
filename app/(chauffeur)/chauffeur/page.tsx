import { redirect } from "next/navigation";
import { ShieldCheck, LogOut } from "lucide-react";
import { getCurrentChauffeur } from "@/lib/auth/chauffeur";
import { chauffeurLogout } from "@/app/(chauffeur)/actions";
import { ChauffeurHome } from "@/components/chauffeur/chauffeur-home";

export const dynamic = "force-dynamic";

export default async function ChauffeurHomePage() {
  const ch = await getCurrentChauffeur();
  if (!ch) redirect("/chauffeur/login");

  if (ch.is_blocked) {
    return (
      <Centered title="Compte bloqué">
        Ton compte chauffeur est bloqué. Contacte le support Coligo.
      </Centered>
    );
  }
  if (!ch.is_verified) {
    return (
      <Centered title="Compte en cours de vérification ⏳">
        Merci {ch.full_name.split(" ")[0]} ! Ton compte et ton véhicule sont en
        cours de vérification par l&apos;équipe Coligo. Tu pourras prendre des
        courses dès qu&apos;il sera validé.
      </Centered>
    );
  }

  return <ChauffeurHome name={ch.full_name} frozen={ch.is_frozen} />;
}

function Centered({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6 text-center">
      <ShieldCheck className="text-primary-600 mx-auto size-10" />
      <h1 className="mt-3 text-xl font-bold">{title}</h1>
      <p className="text-muted mt-2 text-sm">{children}</p>
      <form action={chauffeurLogout} className="mt-6">
        <button
          type="submit"
          className="text-danger-600 hover:bg-danger-50 mx-auto inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"
        >
          <LogOut className="size-4" />
          Déconnexion
        </button>
      </form>
    </div>
  );
}
