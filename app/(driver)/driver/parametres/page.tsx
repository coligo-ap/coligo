import { redirect } from "next/navigation";
import { Bell, Settings, User } from "lucide-react";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { DriverProfileForm } from "@/components/driver/profile-form";
import { DeleteAccountSection } from "@/components/driver/delete-account-section";

export const dynamic = "force-dynamic";

export default async function DriverSettingsPage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="space-y-5">
        <header className="flex items-center gap-2">
          <Settings className="size-6" />
          <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
        </header>

        <section className="border-border bg-surface space-y-3 rounded-[14px] border p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <User className="size-4" />
            Mon profil
          </h2>
          <DriverProfileForm
            initialFullName={driver.full_name}
            initialPhone={driver.phone}
          />
        </section>

        <section className="border-border bg-surface space-y-3 rounded-[14px] border p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bell className="size-4" />
            Notifications
          </h2>
          <p className="text-muted text-sm">
            Les notifications push (nouvelle attribution Express, annonces du
            commerçant) sont activées automatiquement à l&apos;installation de
            l&apos;application. Pour les désactiver, va dans les réglages de ton
            téléphone → Coligo Livreur → Notifications.
          </p>
        </section>

        <DeleteAccountSection />
      </div>
    </DriverShell>
  );
}
