"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Car, ChevronLeft, Heart, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDA } from "@/lib/utils";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { PaymentLine } from "@/components/customer/payment-line";
import { ThemeDecor } from "@/components/shared/theme-decor";
import { VIOLET, ROSE } from "./drive-modals";
import { ChAvatar } from "./ch-avatar";
import {
  getDriveHistory,
  toggleFavoriteChauffeur,
  type DriveHistory,
} from "@/app/(customer)/drive/actions";

/**
 * Chargeur de l'historique Drive via TanStack Query (cache persistant, clé par
 * client). Au RETOUR sur la page : affichage INSTANTANÉ depuis le cache + revalidation
 * silencieuse en fond — plus de squelette plein écran ni de re-téléchargement à
 * chaque visite (la page serveur n'`await` plus les données : elle ne fait que
 * l'auth). Le squelette n'apparaît qu'au tout premier chargement (cache vide).
 *
 * Sécurité : cache en mémoire de l'onglet, clé incluant l'id du compte, et action
 * serveur ré-authentifiée (getCurrentCustomer + RLS) → aucune fuite entre comptes.
 */
export function DriveHistoryLoader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Identité résolue LOCALEMENT (session du navigateur — pas d'aller-retour
  // réseau) : elle ne sert qu'à ISOLER LE CACHE par compte. La page serveur
  // n'`await` plus l'auth (navigation instantanée) ; la protection des données
  // reste dans l'action serveur (ré-auth + RLS à chaque appel).
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!alive) return;
        const id = data.session?.user.id ?? null;
        if (!id) {
          router.replace("/se-connecter?next=/drive/historique");
          return;
        }
        setUid(id);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const { data, isPending } = useQuery({
    queryKey: ["drive-history", uid],
    queryFn: () => getDriveHistory(),
    enabled: uid != null,
    // Réaffichage immédiat de l'ancien contenu pendant la revalidation.
    placeholderData: keepPreviousData,
    // Fraîcheur raisonnable : pas de refetch au montage tant que < 60 s.
    staleTime: 60_000,
  });

  // Retrait d'un favori : mise à jour OPTIMISTE du cache (la carte disparaît tout
  // de suite) puis persistance serveur + invalidation (revalidation en fond).
  const onRemoveFav = useCallback(
    (chauffeurId: string) => {
      queryClient.setQueryData<DriveHistory>(["drive-history", uid], (old) =>
        old
          ? {
              ...old,
              favorites: old.favorites.filter(
                (x) => x.chauffeur_id !== chauffeurId
              ),
            }
          : old
      );
      void toggleFavoriteChauffeur(chauffeurId, false).then(() =>
        queryClient.invalidateQueries({
          queryKey: ["drive-history", uid],
        })
      );
    },
    [queryClient, uid]
  );

  // Squelette UNIQUEMENT au 1er chargement (cache vide) ; sinon on garde l'ancien
  // contenu affiché pendant la revalidation (pas de flash).
  if (isPending && !data) return <DriveHistorySkeleton />;

  return (
    <DriveHistoryView
      history={data ?? EMPTY_HISTORY}
      onRemoveFav={onRemoveFav}
    />
  );
}

const EMPTY_HISTORY: DriveHistory = { rides: [], favorites: [] };

/** Squelette de l'historique Drive (1er chargement + frontière `loading.tsx`).
 *  MÊME structure que la vue (héro thémé + pilule d'onglets) → zéro saut. */
export function DriveHistorySkeleton() {
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] pb-24">
      <div
        className="relative overflow-hidden rounded-b-2xl pb-14 text-white"
        style={{
          backgroundImage:
            "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
        }}
      >
        <ThemeDecor />
        <div className="relative z-10 flex items-center gap-3 px-5 pt-[calc(1rem+env(safe-area-inset-top))]">
          <div className="rounded-card-lg size-[42px] animate-pulse bg-white/20" />
          <div className="h-6 w-40 animate-pulse rounded-lg bg-white/20" />
        </div>
      </div>
      <div className="relative z-10 -mt-10 px-5">
        <div className="shadow-sheet h-[54px] animate-pulse rounded-lg bg-[var(--d-surface)]" />
        <div className="mt-3 space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-[var(--d-line)] bg-[var(--d-page)] p-3.5"
            >
              <div className="size-11 shrink-0 animate-pulse rounded-full bg-[var(--d-soft)]" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--d-soft)]" />
                <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-[var(--d-soft)]" />
              </div>
              <div className="h-5 w-16 animate-pulse rounded bg-[var(--d-soft)]" />
            </div>
          ))}
        </div>
      </div>
      <CustomerBottomNav />
    </div>
  );
}

/** Historique Drive : onglets Courses (terminées/annulées) + ♥ Favoris. */
export function DriveHistoryView({
  history,
  onRemoveFav,
}: {
  history: DriveHistory;
  onRemoveFav: (chauffeurId: string) => void;
}) {
  const t = useTranslations("drive.histo");
  const tc = useTranslations("drive");
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<"c" | "f">("c");
  const favs = history.favorites;

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] pb-24">
      {/* HÉRO au thème « occasion » — même langage que l'accueil Drive. */}
      <div
        className="relative overflow-hidden rounded-b-2xl pb-14 text-white"
        style={{
          backgroundImage:
            "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
        }}
      >
        <ThemeDecor />
        <div className="relative z-10 flex items-center gap-3 px-5 pt-[calc(1rem+env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => router.push("/drive")}
            className="rounded-card-lg grid size-[42px] place-items-center border border-white/25 bg-white/15 text-white"
            aria-label={tc("back")}
          >
            <ChevronLeft className="size-5 rtl:-scale-x-100" />
          </button>
          <h1 className="drive-sora text-display-sm drop- font-extrabold tracking-[-0.5px]">
            {t("title")}
          </h1>
        </div>
      </div>

      {/* Onglets en pilule FLOTTANTE sur le dégradé + contenu dessous. */}
      <div className="relative z-10 -mt-10 px-5">
        <div className="shadow-sheet mb-3 flex gap-1.5 rounded-lg bg-[var(--d-surface)] p-1.5">
          {(
            [
              ["c", t("tabRides"), Car],
              ["f", t("tabFavs"), Heart],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className="flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-2 text-xs font-bold transition-colors"
              style={
                tab === k
                  ? { background: "var(--d-accent)", color: VIOLET }
                  : { color: "var(--d-muted)" }
              }
            >
              <Icon className="size-3.5" />
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
            history.rides.map((r, i) => (
              <div
                key={r.id}
                className="drive-rise rounded-card-xl mb-2 flex items-center gap-3 border border-[var(--d-line)] bg-[var(--d-surface)] p-3"
                style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}
              >
                <span className="rounded-control-lg grid size-[34px] shrink-0 place-items-center bg-[var(--d-soft)]">
                  <Car className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="text-body block truncate">
                    {r.dest_text ?? "—"}
                  </b>
                  <small className="text-caption text-[var(--d-muted)]">
                    {[
                      new Date(r.when).toLocaleDateString(
                        locale === "ar" ? "ar-DZ" : "fr-FR",
                        {
                          day: "numeric",
                          month: "short",
                          timeZone: "Africa/Algiers",
                        }
                      ),
                      r.chauffeur_name,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  {/* Comment ça a été payé : moyen, carte (marque + 4 chiffres),
                    fournisseur. Composant partagé avec les commandes. */}
                  <PaymentLine
                    payment={r.payment}
                    className="mt-0.5 text-[var(--d-muted)]"
                  />
                </span>
                <span className="shrink-0 text-end">
                  <span className="drive-sora text-body-lg block font-extrabold">
                    {formatDA(r.price_da)}
                  </span>
                  <span
                    className="text-nano-lg mt-0.5 inline-block rounded-full px-2 py-0.5 font-extrabold"
                    style={
                      r.completed
                        ? {
                            background: "rgba(22,179,100,.12)",
                            color: "#16B364",
                          }
                        : {
                            background: "rgba(229,72,77,.12)",
                            color: "#E5484D",
                          }
                    }
                  >
                    {r.completed
                      ? tc("status.completed")
                      : tc("status.cancelled")}
                  </span>
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
              className="rounded-card-xl mb-2 flex items-center gap-3 border border-[var(--d-line)] p-3"
            >
              <ChAvatar name={f.name} url={f.avatar_url} size={38} />
              <span className="min-w-0 flex-1">
                <b className="text-body flex items-center gap-1.5">
                  {f.name}
                  {f.rating != null && (
                    <span className="text-caption inline-flex items-center gap-0.5 font-bold text-[var(--color-warning-700)]">
                      <Star
                        className="size-3 shrink-0"
                        style={{ color: "#E8B53C", fill: "#E8B53C" }}
                      />
                      {String(f.rating).replace(".", ",")}
                    </span>
                  )}
                </b>
                <small className="text-caption text-[var(--d-muted)]">
                  {[f.vehicle, t("ridesCount", { count: f.rides_count })]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <button
                type="button"
                aria-label={t("removeFav")}
                onClick={() => onRemoveFav(f.chauffeur_id)}
                className="grid size-[34px] shrink-0 place-items-center rounded-full border-[1.5px]"
                style={{ borderColor: ROSE }}
              >
                <Heart className="size-4" style={{ color: ROSE, fill: ROSE }} />
              </button>
            </div>
          ))
        )}
      </div>

      <CustomerBottomNav />
    </div>
  );
}
