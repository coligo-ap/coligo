"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Bookmark,
  Check,
  ChevronRight,
  History,
  Loader2,
  MapPin,
  Truck,
  UserPlus,
  X,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { PhoneField } from "@/components/ui/phone-field";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { ZoneNotice } from "@/components/zones/zone-notice";
import { AvailabilityNotice } from "@/components/zones/availability-notice";
import { computeDeliveryFee } from "@/lib/delivery/pricing";
import {
  listFavoritePlaces,
  listRecentPlaces,
  type FavPlace,
} from "@/app/(customer)/actions";
import { saveCustomerAddress } from "@/app/(customer)/adresses/actions";
import type { CheckoutDeliveryContext } from "@/app/(customer)/checkout/context";

export type DeliveryChoice = {
  /** "pickup" = retrait sur place ; "delivery" = livraison. */
  fulfillment: "pickup" | "delivery";
  /** Adresse enregistrée choisie (si custom = null + customPosition rempli). */
  addressId: string | null;
  /** Position custom posée à la volée sur la carte (alternative à addressId). */
  customPosition: { lat: number; lng: number } | null;
  /** Adresse lisible résolue (reverse-geocode) du point custom — pour le livreur. */
  customAddressText: string | null;
  /** True quand le client a explicitement confirmé sa position custom. */
  positionConfirmed: boolean;
  /** Mode (requis si fulfillment=delivery). */
  mode: "express" | "tour" | null;
  /** Slot (requis si mode=tour). */
  slotId: string | null;
  /** Téléphone de contact pour la livraison (destinataire). */
  phoneOverride: string;
  /** Nom du destinataire si on livre à quelqu'un d'autre. */
  recipientName: string;
  /** Note livraison (commentaire client → livreur). */
  deliveryNote: string;
};

/** Source de la position de livraison sélectionnée par le client. */
export type PositionSource = "current" | "saved" | "map" | null;

export function hasValidPosition(
  v: DeliveryChoice,
  saved: CheckoutDeliveryContext["addresses"][number] | undefined,
  customOutOfRange: boolean
): boolean {
  if (v.addressId && saved && !saved.out_of_range) return true;
  if (v.customPosition && v.positionConfirmed && !customOutOfRange) return true;
  return false;
}

/** État de la position choisie : détection GPS, zone OK (vert) ou hors zone (rouge). */
export function PositionStatus({
  source,
  gpsState,
  onRetryGps,
  customPosition,
  customAddressText,
  addrLoading,
  customQuote,
  selectedSavedAddress,
  maxRadiusKm,
  mode,
}: {
  source: PositionSource;
  gpsState: "idle" | "loading" | "denied";
  onRetryGps: () => void;
  customPosition: { lat: number; lng: number } | null;
  customAddressText: string | null;
  addrLoading: boolean;
  customQuote: ReturnType<typeof computeDeliveryFee> | null;
  selectedSavedAddress:
    | CheckoutDeliveryContext["addresses"][number]
    | undefined;
  maxRadiusKm: number | null;
  mode: "express" | "tour" | null;
}) {
  const t = useTranslations("checkout");

  // Détection GPS en cours / refusée.
  if (source === "current" && gpsState === "loading") {
    return (
      <StatusLine
        tone="muted"
        icon={<Loader2 className="size-4 animate-spin" />}
      >
        {t("detectingPosition")}
      </StatusLine>
    );
  }
  if (source === "current" && gpsState === "denied" && !customPosition) {
    return (
      <div className="border-danger-200 bg-danger-50 text-danger-700 flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-[13px] font-semibold">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="flex-1">{t("positionDenied")}</span>
        <button
          type="button"
          onClick={onRetryGps}
          className="text-danger-700 shrink-0 font-extrabold underline"
        >
          {t("retryGps")}
        </button>
      </div>
    );
  }

  // Adresse enregistrée sélectionnée.
  if (selectedSavedAddress) {
    if (selectedSavedAddress.out_of_range) {
      return <OutOfZone maxRadiusKm={maxRadiusKm} />;
    }
    const fee =
      mode === "tour"
        ? (selectedSavedAddress.tour_fee_da ??
          selectedSavedAddress.fee_da ??
          null)
        : (selectedSavedAddress.fee_da ?? null);
    return <InZone label={selectedSavedAddress.label} feeDa={fee} />;
  }

  // Position custom (GPS / carte / lieu nommé).
  if (customPosition && customQuote) {
    if (customQuote.outOfRange) return <OutOfZone maxRadiusKm={maxRadiusKm} />;
    return (
      <>
        <InZone
          label={
            addrLoading ? t("searching") : (customAddressText ?? t("mapPoint"))
          }
          feeDa={customQuote.outOfRange ? null : customQuote.feeDa}
          subtitle={t("detectedAddress")}
        />
        {/* Couverture service (moteur de zones, temps réel) + dispo livreurs. */}
        <ZoneNotice
          lat={customPosition.lat}
          lng={customPosition.lng}
          services={mode ? [mode] : ["express", "tour"]}
          role="destination"
          className="mt-1"
        />
        {mode === "express" && (
          <AvailabilityNotice
            service="express"
            lat={customPosition.lat}
            lng={customPosition.lng}
            radiusKm={12}
            className="mt-1"
          />
        )}
      </>
    );
  }

  return null;
}

function InZone({
  label,
  feeDa,
  subtitle,
}: {
  label: string;
  feeDa: number | null;
  subtitle?: string;
}) {
  const t = useTranslations("checkout");
  return (
    <div className="border-success-200 bg-success-50 flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5">
      <span className="bg-success-100 text-success-700 grid size-7 shrink-0 place-items-center rounded-[9px]">
        <Check className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-[13.5px] font-extrabold">
          {label}
        </span>
        <span className="text-success-700 block text-[11px] font-semibold">
          {subtitle ? `${subtitle} · ` : ""}
          {t("inZone")}
        </span>
      </span>
      {feeDa != null && (
        <span className="bg-surface text-foreground ms-auto shrink-0 rounded-[9px] px-2.5 py-1 text-[13px] font-extrabold tabular-nums">
          {formatDA(feeDa)}
        </span>
      )}
    </div>
  );
}

function OutOfZone({ maxRadiusKm }: { maxRadiusKm: number | null }) {
  const t = useTranslations("checkout");
  return (
    <p className="border-danger-200 bg-danger-50 text-danger-700 flex items-start gap-2 rounded-[12px] border px-3 py-2.5 text-[13px] font-semibold">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {t("outOfDeliveryZone")}
        {maxRadiusKm != null
          ? ` (${t("maxRadius", { km: maxRadiusKm.toFixed(1) })})`
          : ""}{" "}
        {t("chooseOtherAddressOrPickup")}
      </span>
    </p>
  );
}

function StatusLine({
  tone,
  icon,
  children,
}: {
  tone: "muted";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-[13px] font-semibold",
        tone === "muted" && "bg-surface-2 text-muted"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

/** Tuile de choix compacte (icône + libellé court, 3 par rangée, style iOS). */
export function ChoiceTile({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-[14px] border px-2 py-3 transition active:scale-[0.97]",
        active
          ? "border-primary-500 bg-primary-50"
          : "border-border bg-surface hover:border-primary-300"
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          active
            ? "bg-primary-100 text-primary-700"
            : "bg-primary-50 text-primary-600"
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "text-center text-[11.5px] leading-tight font-bold",
          active ? "text-primary-800" : "text-foreground"
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * Popup « Mes adresses enregistrées » : Favoris, Adresses enregistrées (profil)
 * et Lieux précédents. Le client choisit une adresse.
 */
export function SavedAddressesModal({
  addresses,
  onPickSaved,
  onPickPlace,
  onClose,
}: {
  addresses: CheckoutDeliveryContext["addresses"];
  onPickSaved: (a: CheckoutDeliveryContext["addresses"][number]) => void;
  onPickPlace: (p: FavPlace) => void;
  onClose: () => void;
}) {
  const t = useTranslations("checkout");
  const [favs, setFavs] = useState<FavPlace[]>([]);
  const [recents, setRecents] = useState<FavPlace[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [f, r] = await Promise.all([
        listFavoritePlaces(),
        listRecentPlaces(),
      ]);
      if (!alive) return;
      setFavs(f);
      setRecents(r);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const empty =
    favs.length === 0 && recents.length === 0 && addresses.length === 0;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-surface flex max-h-[88vh] w-full max-w-md flex-col rounded-t-[20px] pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-[20px]">
          <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
            <h2 className="font-display text-foreground text-lg font-bold">
              {t("savedAddressesChoice")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:bg-surface-2 rounded-full p-1.5"
              aria-label={t("closeLabel")}
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {empty && (
              <p className="text-muted px-1 py-6 text-center text-sm">
                {t("noSavedPlacesYet")}
              </p>
            )}

            {favs.length > 0 && (
              <ModalSection title={t("favorites")}>
                {favs.map((p, i) => (
                  <PlaceRow
                    key={`fav-${i}`}
                    icon={<Bookmark className="size-[18px]" />}
                    title={p.label}
                    onClick={() => onPickPlace(p)}
                  />
                ))}
              </ModalSection>
            )}

            {addresses.length > 0 && (
              <ModalSection title={t("savedAddressesSection")}>
                {addresses.map((a) => (
                  <PlaceRow
                    key={a.id}
                    icon={<MapPin className="size-[18px]" />}
                    title={a.label}
                    sub={
                      a.out_of_range
                        ? t("outOfZone")
                        : (a.address_text ?? undefined)
                    }
                    disabled={a.out_of_range}
                    onClick={() => onPickSaved(a)}
                  />
                ))}
              </ModalSection>
            )}

            {recents.length > 0 && (
              <ModalSection title={t("previousPlaces")}>
                {recents.map((p, i) => (
                  <PlaceRow
                    key={`rec-${i}`}
                    icon={<History className="size-[18px]" />}
                    title={p.label}
                    onClick={() => onPickPlace(p)}
                  />
                ))}
              </ModalSection>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

function ModalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted px-1 text-[11px] font-extrabold tracking-wide uppercase">
        {title}
      </p>
      <div className="divide-border border-border divide-y overflow-hidden rounded-[13px] border">
        {children}
      </div>
    </div>
  );
}

function PlaceRow({
  icon,
  title,
  sub,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hover:bg-surface-2 flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors disabled:opacity-50"
    >
      <span className="bg-primary-50 text-primary-600 grid size-9 shrink-0 place-items-center rounded-full">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-bold">
          {title}
        </span>
        {sub && (
          <span className="text-muted block truncate text-xs">{sub}</span>
        )}
      </span>
      <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
    </button>
  );
}

/**
 * Carte plein écran — EXACTEMENT le composant carte de l'accueil marketplace
 * (MapPositionPicker : recherche + « Tes lieux » + GPS). « Valider » remonte le
 * point au checkout (le contrôle de zone se fait ensuite sur ce point).
 */
export function FullscreenMap({
  initial,
  onValidate,
  onClose,
}: {
  initial: { lat: number; lng: number } | null;
  onValidate: (p: { lat: number; lng: number }) => void;
  onClose: () => void;
}) {
  const t = useTranslations("checkout");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initial
  );

  return (
    <Portal>
      <div className="bg-surface fixed inset-0 z-[100] flex flex-col pt-[env(safe-area-inset-top)]">
        <header className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-3">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeLabel")}
            className="text-foreground hover:bg-surface-2 grid size-9 place-items-center rounded-full"
          >
            <X className="size-5" />
          </button>
          <h2 className="text-foreground flex-1 truncate text-base font-bold">
            {t("selectOnMapChoice")}
          </h2>
        </header>
        <div className="relative min-h-0 flex-1">
          <MapPositionPicker
            initial={coords ?? undefined}
            autoLocate={coords == null}
            onChange={(p) => setCoords(p)}
            gpsLabel={t("myPosition")}
            height="100%"
            searchEnabled
            favoritesEnabled
            searchPlaceholder={t("searchAddressPlaceholder")}
          />
        </div>
        <div className="border-border bg-surface shrink-0 border-t p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={!coords}
            onClick={() => coords && onValidate(coords)}
          >
            <Check className="size-4" />
            {t("validateThisPosition")}
          </Button>
        </div>
      </div>
    </Portal>
  );
}

/** Enregistrer la position confirmée comme adresse du profil (label + save). */
export function SaveAddressInline({
  lat,
  lng,
  addressText,
}: {
  lat: number;
  lng: number;
  addressText: string | null;
}) {
  const t = useTranslations("checkout");
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (saved) {
    return (
      <p className="text-success-700 flex items-center gap-1.5 px-1 text-[12px] font-semibold">
        <Check className="size-3.5" />
        {t("addressSavedToProfile")}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary-700 px-1 text-xs font-semibold underline"
      >
        {t("saveThisAddress")}
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setErr(null);
          }}
          placeholder={t("addressLabelPlaceholder")}
          className="h-10 flex-1"
          maxLength={60}
        />
        <button
          type="button"
          disabled={pending || label.trim() === ""}
          onClick={() =>
            start(async () => {
              setErr(null);
              const res = await saveCustomerAddress({
                label,
                lat,
                lng,
                address_text: addressText,
              });
              if (res.ok) setSaved(true);
              else setErr(res.error ?? t("saveFailed"));
            })
          }
          className="bg-foreground text-background shrink-0 rounded-[10px] px-4 text-sm font-extrabold disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : t("save")}
        </button>
      </div>
      {/* Erreur EN LIGNE sous le champ (pas de toast, cf. CLAUDE.md). */}
      {err && (
        <p className="text-danger-600 px-1 text-[12px] font-semibold">{err}</p>
      )}
    </div>
  );
}

/** Livrer à quelqu'un d'autre (nom + tél) + note livreur. */
export function RecipientBlock({
  value,
  update,
}: {
  value: DeliveryChoice;
  update: (patch: Partial<DeliveryChoice>) => void;
}) {
  const t = useTranslations("checkout");
  const [forSomeoneElse, setForSomeoneElse] = useState(
    value.recipientName.trim() !== ""
  );

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          const next = !forSomeoneElse;
          setForSomeoneElse(next);
          if (!next) update({ recipientName: "", phoneOverride: "" });
        }}
        className={cn(
          "flex w-full items-center gap-3 rounded-[12px] border p-3 text-start transition",
          forSomeoneElse
            ? "border-primary-500 bg-primary-50"
            : "border-border bg-surface hover:border-primary-300"
        )}
      >
        <UserPlus
          className={cn(
            "size-4 shrink-0",
            forSomeoneElse ? "text-primary-600" : "text-muted"
          )}
        />
        <span className="flex-1 text-sm font-semibold">
          {t("deliverToSomeoneElse")}
        </span>
        <span
          className={cn(
            "grid size-[22px] shrink-0 place-items-center rounded-[7px] border-2",
            forSomeoneElse
              ? "border-primary-600 bg-primary-600 text-white"
              : "border-border-strong bg-white"
          )}
        >
          {forSomeoneElse && <Check className="size-3.5" />}
        </span>
      </button>

      {forSomeoneElse && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={value.recipientName}
            onChange={(e) => update({ recipientName: e.target.value })}
            placeholder={t("recipientNamePlaceholder")}
            maxLength={80}
          />
          {/* Le numéro du destinataire n'était jusqu'ici jamais validé : une
              saisie incomplète partait telle quelle jusqu'au livreur. Le champ
              partagé ne remonte qu'une forme canonique, ou rien. */}
          <PhoneField
            label={null}
            defaultValue={value.phoneOverride}
            onValueChange={(canonical) =>
              update({ phoneOverride: canonical ?? "" })
            }
          />
        </div>
      )}

      <textarea
        value={value.deliveryNote}
        onChange={(e) => update({ deliveryNote: e.target.value })}
        placeholder={t("deliveryNotePlaceholder")}
        className="border-border bg-surface min-h-[52px] w-full rounded-[10px] border px-3 py-2 text-sm"
        maxLength={300}
      />
    </div>
  );
}

/** Onglet du toggle Retrait/Livraison (au-dessus de la pilule glissante). */
export function ModeTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-[2] flex flex-1 items-center justify-center gap-2 rounded-[11px] py-3 text-sm font-extrabold transition active:scale-[0.98]",
        active ? "text-foreground" : "text-muted"
      )}
    >
      <span className={active ? "text-primary-600" : ""}>{icon}</span>
      {label}
    </button>
  );
}

export function ModeButton({
  icon,
  label,
  sub,
  badge,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  /** Étiquette promo (ex. « Livraison offerte ») affichée DANS la carte. */
  badge?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-start gap-2 rounded-[12px] border p-3 text-start transition active:scale-[0.98]",
        active
          ? "border-primary-500 bg-primary-50"
          : "border-border bg-surface hover:border-primary-300"
      )}
    >
      <span
        className={cn("mt-0.5", active ? "text-primary-600" : "text-muted")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-muted text-xs">{sub}</span>
        {badge && (
          // Texte JAMAIS tronqué : l'étiquette passe à la ligne si besoin
          // (rounded-[9px] pour rester joli sur 2 lignes).
          <span className="bg-success-600 mt-1.5 inline-flex max-w-full items-start gap-1 rounded-[9px] px-1.5 py-1 text-[10.5px] leading-[1.25] font-bold text-white">
            <Truck className="mt-px size-3 shrink-0" />
            <span>{badge}</span>
          </span>
        )}
      </span>
    </button>
  );
}
