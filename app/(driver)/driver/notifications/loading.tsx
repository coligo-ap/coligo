import { DriverBottomNav } from "@/components/driver/driver-bottom-nav";

/** Squelette des notifications internes du livreur. */
export default function DriverNotificationsLoading() {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-surface)]">
      <main className="pt-safe pb-safe-nav mx-auto max-w-md space-y-2 px-5">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-[var(--soft)]" />
        <div className="rounded-card-lg h-20 animate-pulse bg-[var(--soft)]" />
        <div className="rounded-card-lg h-20 animate-pulse bg-[var(--soft)]" />
        <div className="rounded-card-lg h-20 animate-pulse bg-[var(--soft)]" />
      </main>
      <DriverBottomNav />
    </div>
  );
}
