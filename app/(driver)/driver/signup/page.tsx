import Link from "next/link";
import { DriverSignupForm } from "@/components/driver/signup-form";

export const dynamic = "force-dynamic";

export default function DriverSignupPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Devenir livreur</h1>
        <p className="text-muted text-sm">
          Crée ton compte avec un téléphone et un mot de passe. Tu pourras
          ensuite saisir le code d&apos;un commerçant pour rejoindre sa
          boutique.
        </p>
      </header>
      <DriverSignupForm />
      <p className="text-muted text-sm">
        Déjà inscrit ?{" "}
        <Link href="/driver/login" className="text-primary-600 underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
