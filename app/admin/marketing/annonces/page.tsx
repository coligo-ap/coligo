import { requireAdminDomain } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AnnouncementsManager,
  type AdminAnnouncement,
  type AnnouncementStatsMap,
} from "@/components/admin/announcements-manager";

export const dynamic = "force-dynamic";

// =============================================================================
// Onglet « Annonces » du hub Marketing (mig 0408) — communications ciblées
// push + pop-up, façon Uber/Bolt. Self-guard : requireAdminDomain AVANT toute
// lecture service_role.
// =============================================================================
export default async function MarketingAnnouncementsTab() {
  await requireAdminDomain("marketing");

  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => {
      order: (
        col: string,
        o: { ascending: boolean }
      ) => {
        limit: (n: number) => Promise<{ data: AdminAnnouncement[] | null }>;
      };
    };
  };
  const { data: rows } = await from("announcements")
    .select(
      "id, status, title_fr, title_ar, body_fr, body_ar, image_url, audiences, channel, popup_mode, route_prefix, blocking, buttons, starts_at, ends_at, push_sent_at, push_sent_count, disabled_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  // Stats agrégées en UNE requête (pas de N+1 RPC).
  const receiptsFrom = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => Promise<{
      data:
        | {
            announcement_id: string;
            seen_at: string | null;
            acked_at: string | null;
            dismissed_at: string | null;
            clicked_button: number | null;
          }[]
        | null;
    }>;
  };
  const { data: receipts } = await receiptsFrom("announcement_receipts").select(
    "announcement_id, seen_at, acked_at, dismissed_at, clicked_button"
  );
  const stats: AnnouncementStatsMap = {};
  for (const r of receipts ?? []) {
    const s = (stats[r.announcement_id] ??= {
      impressions: 0,
      acked: 0,
      dismissed: 0,
      clicks_0: 0,
      clicks_1: 0,
    });
    if (r.seen_at) s.impressions++;
    if (r.acked_at) s.acked++;
    if (r.dismissed_at) s.dismissed++;
    if (r.clicked_button === 0) s.clicks_0++;
    if (r.clicked_button === 1) s.clicks_1++;
  }

  // Anti-spam : audiences déjà servies (publiées) dans les dernières 24 h.
  const audiences24h: Record<string, number> = {};
  for (const a of rows ?? []) {
    if (
      a.status === "published" &&
      !a.disabled_at &&
      Date.now() - new Date(a.starts_at).getTime() < 24 * 3600e3 &&
      new Date(a.starts_at) <= new Date()
    ) {
      for (const aud of a.audiences) {
        audiences24h[aud] = (audiences24h[aud] ?? 0) + 1;
      }
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-extrabold">Annonces</h1>
        <p className="text-muted mt-1 text-sm">
          Communications ciblées par rôle : push FCM et/ou pop-up in-app (à
          l&apos;ouverture, instantanée, ou sur une page précise), normale ou
          BLOQUANTE, avec boutons d&apos;action. Chaque envoi est journalisé.
        </p>
      </header>

      <AnnouncementsManager
        rows={rows ?? []}
        stats={stats}
        audiences24h={audiences24h}
      />
    </div>
  );
}
