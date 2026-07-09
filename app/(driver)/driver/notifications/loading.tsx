import { DriverBottomNav } from "@/components/driver/driver-bottom-nav";

/** Squelette des notifications internes du livreur. */
export default function DriverNotificationsLoading() {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-surface)]">
      <main className="mx-auto max-w-md space-y-2 px-5 pt-4 pb-24">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-[var(--soft)]" />
        <div className="h-20 animate-pulse rounded-[14px] bg-[var(--soft)]" />
        <div className="h-20 animate-pulse rounded-[14px] bg-[var(--soft)]" />
        <div className="h-20 animate-pulse rounded-[14px] bg-[var(--soft)]" />
      </main>
      <DriverBottomNav />
    </div>
  );
}
