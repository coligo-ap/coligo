"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Car, ChevronLeft, Heart } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { VIOLET, ROSE } from "./drive-modals";
import { ChAvatar } from "./ch-avatar";
import {
  toggleFavoriteChauffeur,
  type DriveHistory,
} from "@/app/(customer)/drive/actions";

/** Historique Drive : onglets Courses (terminées/annulées) + ♥ Favoris. */
export function DriveHistoryView({ history }: { history: DriveHistory }) {
  const t = useTranslations("drive.histo");
  const tc = useTranslations("drive");
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<"c" | "f">("c");
  const [favs, setFavs] = useState(history.favorites);

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/drive")}
          className="grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
          aria-label={tc("back")}
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
          {t("title")}
        </h1>
      </div>

      <div className="mb-3 flex gap-2">
        {(
          [
            ["c", t("tabRides")],
            ["f", `♥ ${t("tabFavs")}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="flex-1 rounded-[12px] border-[1.5px] px-1.5 py-2.5 text-xs font-bold"
            style={
              tab === k
                ? { borderColor: VIOLET, background: "#EEEEFD", color: VIOLET }
                : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "c" ? (
        history.rides.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--d-muted)]">
            {t("emptyRides")}
          </p>
        ) : (
          history.rides.map((r) => (
            <div
              key={r.id}
              className="mb-2 flex items-center gap-3 rounded-[15px] border border-[var(--d-line)] p-3"
            >
              <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-[var(--d-soft)]">
                <Car className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13.5px]">
                  {r.dest_text ?? "—"}
                </b>
                <small className="text-[11px] text-[var(--d-muted)]">
                  {[
                    new Date(r.when).toLocaleDateString(
                      locale === "ar" ? "ar-DZ" : "fr-FR",
                      {
                        day: "numeric",
                        month: "short",
                      }
                    ),
                    r.chauffeur_name,
                    formatDA(r.price_da),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <span
                className="shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold"
                style={
                  r.completed
                    ? { background: "rgba(22,179,100,.12)", color: "#16B364" }
                    : { background: "rgba(229,72,77,.12)", color: "#E5484D" }
                }
              >
                {r.completed ? tc("status.completed") : tc("status.cancelled")}
              </span>
            </div>
          ))
        )
      ) : favs.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--d-muted)]">
          {t("emptyFavs")}
        </p>
      ) : (
        favs.map((f) => (
          <div
            key={f.chauffeur_id}
            className="mb-2 flex items-center gap-3 rounded-[15px] border border-[var(--d-line)] p-3"
          >
            <ChAvatar name={f.name} url={f.avatar_url} size={38} />
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px]">
                {f.name}
                {f.rating != null
                  ? ` · ★ ${String(f.rating).replace(".", ",")}`
                  : ""}
              </b>
              <small className="text-[11px] text-[var(--d-muted)]">
                {[f.vehicle, t("ridesCount", { count: f.rides_count })]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <button
              type="button"
              aria-label={t("removeFav")}
              onClick={async () => {
                setFavs((l) =>
                  l.filter((x) => x.chauffeur_id !== f.chauffeur_id)
                );
                await toggleFavoriteChauffeur(f.chauffeur_id, false);
              }}
              className="grid size-[34px] shrink-0 place-items-center rounded-full border-[1.5px]"
              style={{ borderColor: ROSE }}
            >
              <Heart className="size-4" style={{ color: ROSE, fill: ROSE }} />
            </button>
          </div>
        ))
      )}

      <CustomerBottomNav />
    </div>
  );
}
