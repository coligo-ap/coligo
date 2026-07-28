"use client";

// =============================================================================
// Cloche de notifications + centre (feuille du bas) — style Bolt, 3 espaces.
// =============================================================================
// Badge temps réel (Realtime INSERT, mig 0363/0364) sans rechargement. Le
// contenu s'affiche dans une feuille ancrée en bas (Portal, tokens --d-* →
// correct en clair/sombre partout, y compris l'espace client). Ouverture =
// tout marqué lu (optimiste), mais les entrées fraîches gardent leur pastille
// le temps de la session de lecture.
// =============================================================================

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Bell,
  BellOff,
  Car,
  Gift,
  MessageSquare,
  Package,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import {
  useAppNotifications,
  type AppNotification,
  type NotifSource,
} from "@/lib/notifications/use-notifications";

const VIOLET = "#6C2BD9";

/** Icône par famille d'événement (jamais d'emoji — lucide only). */
function kindIcon(kind: string) {
  if (kind === "ride_tip") return Gift;
  if (kind.startsWith("ride_")) return Car;
  if (kind.startsWith("order_") || kind.startsWith("delivery_")) return Package;
  if (kind.includes("message")) return MessageSquare;
  return Bell;
}

function timeAgo(iso: string, locale: string): string {
  const s = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  const ar = locale === "ar";
  if (s < 60) return ar ? "الآن" : "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return ar ? `قبل ${m} د` : `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return ar ? `قبل ${h} س` : `il y a ${h} h`;
  return new Date(iso).toLocaleDateString(ar ? "ar-DZ" : "fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export function NotificationBell({
  source,
  className,
  iconClassName = "size-[18px]",
}: {
  source: NotifSource;
  /** Style du bouton (repris du header de l'espace hôte). */
  className?: string;
  iconClassName?: string;
}) {
  const t = useTranslations("notifs");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { items, unread, markAllRead, removeOne, clearAll } =
    useAppNotifications(source);
  // Pastilles « nouveau » figées à l'ouverture (le marquage lu est optimiste).
  const freshIdsRef = useRef<Set<string>>(new Set());

  const openSheet = () => {
    freshIdsRef.current = new Set(
      items.filter((n) => !n.read_at).map((n) => n.id)
    );
    setOpen(true);
    void markAllRead();
  };

  const go = (n: AppNotification) => {
    setOpen(false);
    if (n.route) router.push(n.route);
  };

  const groups = useMemo(() => items, [items]);

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label={t("title")}
        className={cn("relative", className)}
      >
        <Bell className={iconClassName} />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 grid h-4 min-w-[16px] place-items-center rounded-full px-1 text-[9px] font-extrabold text-white"
            style={{ background: "#E5484D" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[130] flex items-end justify-center bg-[rgba(8,9,15,.45)] sm:items-center"
            onClick={() => setOpen(false)}
          >
            <div
              className="drive-up drive-jakarta flex max-h-[78vh] w-full flex-col rounded-t-[26px] bg-[var(--d-surface)] text-[var(--d-ink)] sm:max-w-md sm:rounded-[26px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-5 pt-4 pb-2">
                <span
                  className="grid size-9 place-items-center rounded-full"
                  style={{ background: "var(--d-accent)", color: VIOLET }}
                >
                  <Bell className="size-4" />
                </span>
                <h2 className="drive-sora flex-1 text-[17px] font-extrabold tracking-[-0.3px]">
                  {t("title")}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("close")}
                  className="grid size-9 place-items-center rounded-full bg-[var(--d-soft)] text-[var(--d-muted)]"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="min-h-[180px] flex-1 overflow-y-auto px-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
                {groups.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <span className="grid size-12 place-items-center rounded-full bg-[var(--d-soft)]">
                      <BellOff className="size-5 text-[var(--d-muted)]" />
                    </span>
                    <p className="text-[13px] font-semibold text-[var(--d-muted)]">
                      {t("empty")}
                    </p>
                  </div>
                ) : (
                  groups.map((n) => {
                    const Icon = kindIcon(n.kind);
                    const fresh = freshIdsRef.current.has(n.id);
                    return (
                      // div role=button (PAS un <button>) : la croix de
                      // suppression est un vrai bouton à l'intérieur — un
                      // bouton imbriqué casserait l'hydratation.
                      <div
                        key={n.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => go(n)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") go(n);
                        }}
                        className="flex w-full cursor-pointer items-start gap-3 rounded-[16px] p-3 text-start transition-colors active:bg-[var(--d-soft)]"
                        style={
                          fresh ? { background: "var(--d-accent)" } : undefined
                        }
                      >
                        <span
                          className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--d-soft)]"
                          style={fresh ? { color: VIOLET } : undefined}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <b className="min-w-0 flex-1 truncate text-[13px]">
                              {n.title}
                            </b>
                            <small className="shrink-0 text-[10.5px] font-medium text-[var(--d-muted)]">
                              {timeAgo(n.created_at, locale)}
                            </small>
                          </span>
                          {n.body && (
                            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-[var(--d-muted)]">
                              {n.body}
                            </span>
                          )}
                        </span>
                        {fresh && (
                          <span
                            className="mt-2 size-2 shrink-0 rounded-full"
                            style={{ background: VIOLET }}
                          />
                        )}
                        {/* Suppression DÉFINITIVE de cette notification. */}
                        <button
                          type="button"
                          aria-label={t("deleteOne")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeOne(n.id);
                          }}
                          className="-m-2 grid size-11 shrink-0 place-items-center self-center rounded-full text-[var(--d-muted)] transition-colors hover:text-[var(--d-ink)]"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Tout effacer — suppression définitive, pied de feuille. */}
              {groups.length > 0 && (
                <div className="border-t border-[var(--d-line)] px-5 py-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                  <button
                    type="button"
                    onClick={() => void clearAll()}
                    className="mx-auto flex min-h-[44px] items-center justify-center gap-2 text-[13px] font-bold text-[var(--d-muted)] transition-colors hover:text-[#E5484D]"
                  >
                    <Trash2 className="size-4" />
                    {t("clearAll")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
