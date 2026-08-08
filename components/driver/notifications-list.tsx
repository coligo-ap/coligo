"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { BadgeCheck, Bell, ChevronRight, XCircle } from "lucide-react";
import {
  BRAND_GO,
  BRAND_RED,
  BRAND_VIOLET,
  SORA,
} from "@/components/shared/partner-ui";
import { markDriverNotificationsRead } from "@/app/(driver)/actions";

export type DriverNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  route: string | null;
  read_at: string | null;
  created_at: string;
};

const TONES: Record<string, { icon: React.ReactNode; color: string }> = {
  driver_account_verified: {
    icon: <BadgeCheck className="size-4" />,
    color: BRAND_GO,
  },
  driver_account_rejected: {
    icon: <XCircle className="size-4" />,
    color: BRAND_RED,
  },
};

export function DriverNotificationsList({
  items,
}: {
  items: DriverNotification[];
}) {
  const isAr = useLocale() === "ar";
  // Ouvrir la liste vaut lecture : on marque tout comme lu (RPC dédiée — le
  // livreur ne peut pas réécrire le contenu d'une notification).
  useEffect(() => {
    if (items.some((n) => n.read_at == null))
      void markDriverNotificationsRead();
  }, [items]);

  return (
    <ul className="space-y-2">
      {items.map((n) => {
        const tone = TONES[n.kind] ?? {
          icon: <Bell className="size-4" />,
          color: BRAND_VIOLET,
        };
        const body = (
          <div
            className="rounded-card-lg flex items-start gap-3 border p-3.5"
            style={{
              borderColor: n.read_at ? "var(--line)" : tone.color,
              background: "var(--surface)",
            }}
          >
            <span
              className="rounded-control-lg grid size-9 shrink-0 place-items-center"
              style={{ background: "var(--soft)", color: tone.color }}
            >
              {tone.icon}
            </span>
            <div className="min-w-0 flex-1">
              <b
                className="text-body block font-bold text-[var(--ink)]"
                style={{ fontFamily: SORA }}
              >
                {n.title}
              </b>
              <small className="text-label mt-0.5 block leading-relaxed text-[var(--muted)]">
                {n.body}
              </small>
              <small className="text-caption mt-1 block text-[var(--muted)]">
                {new Date(n.created_at).toLocaleDateString(
                  isAr ? "ar-DZ" : "fr-FR",
                  {
                    day: "2-digit",
                    month: "long",
                  }
                )}
              </small>
            </div>
            {n.route && (
              <ChevronRight className="size-4 shrink-0 self-center text-[var(--muted)] rtl:rotate-180" />
            )}
          </div>
        );
        return (
          <li key={n.id}>
            {n.route ? <Link href={n.route}>{body}</Link> : body}
          </li>
        );
      })}
    </ul>
  );
}
