import {
  AlertTriangle,
  Ban,
  MapPin,
  MonitorSmartphone,
  Search,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { IpActions, UserDisconnect } from "@/components/admin/device-actions";

export const dynamic = "force-dynamic";

/**
 * Appareils & connexions (super-admin) — traçage IP / localisation réseau /
 * appareil de chaque utilisateur (alimenté par /api/telemetry/ping).
 * Recherche par email, IP, ville ou pays + rapport anti-fraude (IP partagées
 * par plusieurs comptes = multi-comptes probables).
 */

type DeviceRow = {
  user_id: string;
  email: string;
  role: string;
  ip: string;
  ua: string;
  platform: string | null;
  is_standalone: boolean | null;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  first_seen_at: string;
  last_seen_at: string;
  hits: number;
};

type SharedIp = {
  ip: string;
  user_count: number;
  emails: string[];
  roles: string[];
  city: string | null;
  country: string | null;
  last_seen_at: string;
};

const ROLE_LABEL: Record<string, string> = {
  customer: "Client",
  courier: "Livreur",
  merchant: "Commerçant",
  chauffeur: "Chauffeur",
};

const PLATFORM_LABEL: Record<string, string> = {
  android: "Android",
  ios: "iPhone/iPad",
  windows: "Windows",
  macos: "Mac",
  linux: "Linux",
  other: "Autre",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Africa/Algiers",
  });

export default async function AdminDevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const admin = createAdminClient();

  // RPC hors types générés — toujours .bind(admin) (cf. reference_supabase_rpc_bind).
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown }>;
  const [{ data: rowsRaw }, { data: sharedRaw }] = await Promise.all([
    rpc("admin_device_rows", { p_q: q || null, p_limit: 120 }),
    rpc("admin_shared_ips", { p_limit: 50 }),
  ]);
  const rows = (rowsRaw ?? []) as DeviceRow[];
  const shared = (sharedRaw ?? []) as SharedIp[];

  // IP déjà bloquées (mig 0287) → pour afficher le bon bouton (Bloquer/Débloquer).
  // blocked_ips hors types générés → .from bindé + cast (cf. reference_supabase_rpc_bind).
  const fromB = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => Promise<{ data: { ip: string }[] | null }>;
  };
  const { data: blkRaw } = await fromB("blocked_ips").select("ip");
  const blockedSet = new Set((blkRaw ?? []).map((r) => r.ip));

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <MonitorSmartphone className="text-primary-600 size-6" />
          Appareils &amp; connexions
        </h1>
        <p className="text-muted mt-1 text-sm">
          IP, localisation réseau et appareils de chaque utilisateur (mis à jour
          à chaque session, toutes les ~6 h par appareil). Sert à maîtriser les
          comptes et détecter fraude et abus.
        </p>
      </header>

      {/* Anti-fraude : IP partagées entre plusieurs comptes */}
      {shared.length > 0 && (
        <section className="border-warning-300 bg-warning-50 mb-6 rounded-[14px] border p-4">
          <h2 className="text-warning-800 mb-2 flex items-center gap-1.5 text-sm font-bold">
            <AlertTriangle className="size-4" />
            IP partagées par plusieurs comptes ({shared.length})
          </h2>
          <div className="space-y-2">
            {shared.map((s) => (
              <div
                key={s.ip}
                className="border-warning-200 rounded-[10px] border bg-white p-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/admin/devices?q=${encodeURIComponent(s.ip)}`}
                    className="text-primary-700 font-bold tabular-nums hover:underline"
                  >
                    {s.ip}
                  </a>
                  <span className="bg-warning-100 text-warning-800 rounded-full px-2 py-0.5 font-bold">
                    {s.user_count} comptes
                  </span>
                  <span className="text-muted">
                    {[s.city, s.country].filter(Boolean).join(", ") || "—"}
                  </span>
                  {blockedSet.has(s.ip) && (
                    <span className="bg-danger-100 text-danger-700 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold">
                      <Ban className="size-3" />
                      Bloquée
                    </span>
                  )}
                  <span className="text-muted ml-auto">
                    {fmtDate(s.last_seen_at)}
                  </span>
                </div>
                <p className="text-muted mt-1 break-all">
                  {s.emails.join(" · ")}
                  <span className="ml-2">
                    ({s.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")})
                  </span>
                </p>
                <div className="mt-2">
                  <IpActions ip={s.ip} blocked={blockedSet.has(s.ip)} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recherche */}
      <form method="GET" className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Rechercher : email, IP, ville, pays (ex. DZ)…"
            className="border-border focus:border-primary-400 h-10 w-full rounded-[10px] border bg-white pr-3 pl-9 text-sm outline-none"
          />
        </div>
        <button
          type="submit"
          className="bg-primary-600 hover:bg-primary-700 h-10 rounded-[10px] px-4 text-sm font-semibold text-white"
        >
          Rechercher
        </button>
      </form>

      {/* Résultats */}
      {rows.length === 0 ? (
        <p className="text-muted text-sm">
          {q
            ? "Aucun appareil ne correspond à cette recherche."
            : "Aucun appareil tracé pour l'instant — les données arrivent au fil des connexions."}
        </p>
      ) : (
        <div className="border-border overflow-x-auto rounded-[14px] border bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-border text-muted border-b uppercase">
              <tr>
                <th className="px-3 py-2">Utilisateur</th>
                <th className="px-3 py-2">Rôle</th>
                <th className="px-3 py-2">Appareil</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">Localisation</th>
                <th className="px-3 py-2">Dernière activité</th>
                <th className="px-3 py-2 text-right">Sessions</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((r) => (
                <tr key={`${r.user_id}-${r.role}-${r.ip}-${r.ua}`}>
                  <td className="max-w-[220px] truncate px-3 py-2 font-semibold">
                    <a
                      href={`/admin/devices?q=${encodeURIComponent(r.email)}`}
                      className="hover:text-primary-700 hover:underline"
                    >
                      {r.email}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <span className="bg-primary-50 text-primary-700 rounded-full px-2 py-0.5 font-bold">
                      {ROLE_LABEL[r.role] ?? r.role}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-semibold",
                        r.platform === "android" &&
                          "bg-success-50 text-success-700",
                        r.platform === "ios" && "bg-surface-2",
                        !["android", "ios"].includes(r.platform ?? "") &&
                          "bg-surface-2 text-muted"
                      )}
                      title={r.ua}
                    >
                      {PLATFORM_LABEL[r.platform ?? ""] ?? "?"}
                    </span>
                    {r.is_standalone && (
                      <span
                        className="bg-primary-50 text-primary-700 ml-1 rounded-full px-2 py-0.5 font-semibold"
                        title="Application installée (PWA/APK)"
                      >
                        App
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <a
                      href={`/admin/devices?q=${encodeURIComponent(r.ip)}`}
                      className="hover:text-primary-700 hover:underline"
                    >
                      {r.ip}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="text-muted size-3" />
                      {[r.city, r.region, r.country]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </span>
                    {r.lat != null && r.lng != null && (
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=12/${r.lat}/${r.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-700 ml-1.5 font-semibold hover:underline"
                      >
                        carte
                      </a>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 tabular-nums"
                    title={`Première fois : ${fmtDate(r.first_seen_at)}`}
                  >
                    {fmtDate(r.last_seen_at)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {r.hits}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <UserDisconnect userId={r.user_id} />
                      <IpActions
                        ip={r.ip}
                        blocked={blockedSet.has(r.ip)}
                        showDisconnect={false}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
