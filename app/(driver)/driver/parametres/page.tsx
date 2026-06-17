import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChevronRight, Smartphone, Wallet } from "lucide-react";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { CompteLoader } from "@/components/driver/profile/compte-loader";
import { DriverInfoSection } from "@/components/driver/profile/driver-info-section";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import type { CompteData } from "@/components/driver/profile/compte-view";

export const dynamic = "force-dynamic";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default async function DriverProfilePage() {
  // Page mince : barrière d'auth serveur (sécurité), puis le RÉSUMÉ est lu côté
  // client via TanStack Query (CompteLoader) → réaffichage instantané au retour.
  // Le « seed » (champs bon marché déjà connus) permet d'afficher le hero tout
  // de suite. Les « Mes informations » (lourdes) sont streamées via <Suspense>.
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  const seed: CompteData = {
    initials: initialsOf(driver.full_name),
    avatarUrl: driver.avatar_url,
    fullName: driver.full_name,
    ratingAvg: 0,
    ratingCount: 0,
    coursesCount: 0,
    joinedYear: null,
    verified: driver.is_verified,
    frozen: driver.is_frozen,
    vehicleLabel: null,
    vehiclePlate: null,
    payoutMethod: null,
    payoutDetails: null,
    outstandingDa: 0,
    capDa: 8000,
  };

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <CompteLoader driverId={driver.id} seed={seed}>
        <Suspense
          fallback={
            <div className="mt-4 space-y-2">
              <div className="h-14 animate-pulse rounded-[14px] bg-[var(--soft)]" />
              <div className="h-14 animate-pulse rounded-[14px] bg-[var(--soft)]" />
              <div className="h-14 animate-pulse rounded-[14px] bg-[var(--soft)]" />
            </div>
          }
        >
          <DriverInfoSection
            driverId={driver.id}
            verified={driver.is_verified}
          />
        </Suspense>

        {/* Portefeuille & recharge (solde, carte/CCP, points proches) */}
        <Link
          href="/driver/recharger"
          className="mt-4 flex items-center gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors active:scale-[0.99]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--violet-soft)] text-[var(--violet)]">
            <Wallet className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--ink)]">
              Portefeuille & recharge
            </span>
            <span className="block text-xs text-[var(--muted)]">
              Solde, recharge par carte/CCP et points proches.
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-[var(--muted)]" />
        </Link>

        {/* Télécharger l'app Android « Coligo Livreur » */}
        <Link
          href="/driver/telecharger"
          className="mt-4 flex items-center gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors active:scale-[0.99]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--violet-soft)] text-[var(--violet)]">
            <Smartphone className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--ink)]">
              Télécharger l’application Android
            </span>
            <span className="block text-xs text-[var(--muted)]">
              Nouvelles courses, géoloc fiable et plein écran.
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-[var(--muted)]" />
        </Link>

        {/* Installer la PWA livreur (« Coligo Livreur ») — masqué si installée/APK */}
        <div className="mt-4">
          <InstallAppButton />
        </div>
      </CompteLoader>
    </DriverShell>
  );
}
