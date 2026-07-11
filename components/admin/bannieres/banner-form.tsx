"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  ArrowRight,
  Loader2,
  ImagePlus,
  MapPin,
  Search,
  Store,
  Ticket,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  uploadBannerImage,
  searchOfferMerchants,
  listMerchantOffers,
  type BannerInput,
  type BannerZone,
  type OfferMerchantOption,
  type OfferOption,
} from "@/app/admin/bannieres/actions";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import {
  ACCENTS,
  ACCENT_CLASSES,
  ACCENT_LABELS,
  FIT_OPTIONS,
  resizeImage,
  draftToInput,
  offerSummary,
  suggestedCta,
  INPUT,
  LABEL,
  type AdminBanner,
  type Draft,
} from "./banners-shared";

function PreviewCard({ d }: { d: Draft }) {
  const hasImg = !!d.image_url;
  const scrim = hasImg && d.image_fit !== "overlay";
  return (
    <article
      className={cn(
        "relative flex flex-col justify-between overflow-hidden rounded-[20px] bg-gradient-to-br px-5 py-5 shadow-md",
        ACCENT_CLASSES[d.accent]
      )}
      style={{ minHeight: 140 }}
    >
      {hasImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={d.image_url}
          alt=""
          className={cn(
            "absolute inset-0 h-full w-full",
            d.image_fit === "cover"
              ? "object-cover"
              : d.image_fit === "contain"
                ? "object-contain"
                : "object-cover mix-blend-overlay"
          )}
          style={
            d.image_fit === "overlay"
              ? { opacity: (d.overlay_opacity ?? 30) / 100 }
              : undefined
          }
        />
      )}
      {scrim && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
      )}
      <div className="relative">
        {d.mode === "offer" && d.offer_summary && (
          <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold backdrop-blur">
            <Ticket className="size-3" />
            {d.offer_summary}
          </span>
        )}
        <h3 className="font-display text-lg leading-tight font-bold">
          {d.title || "Titre de la bannière"}
        </h3>
        {d.subtitle && <p className="mt-1 text-sm opacity-90">{d.subtitle}</p>}
      </div>
      {d.cta_label && (
        <div className="relative mt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur">
            {d.cta_label}
            <ArrowRight className="size-3.5" />
          </span>
        </div>
      )}
    </article>
  );
}

/**
 * Éditeur de ZONES ciblées (rayon). Aucune zone = bannière GLOBALE (visible
 * partout). Plusieurs zones possibles : la bannière s'affiche aux utilisateurs
 * situés dans l'UNE des zones.
 */
function ZonesEditor({
  zones,
  onChange,
}: {
  zones: BannerZone[];
  onChange: (z: BannerZone[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [radius, setRadius] = useState(10);
  const [label, setLabel] = useState("");

  const add = () => {
    if (!center) return;
    onChange([
      ...zones,
      {
        label: label.trim(),
        center_lat: center.lat,
        center_lng: center.lng,
        radius_km: Math.max(1, Math.min(200, Math.round(radius))),
      },
    ]);
    setAdding(false);
    setCenter(null);
    setRadius(10);
    setLabel("");
  };

  return (
    <div className="border-border-strong space-y-3 rounded-[12px] border border-dashed p-3">
      <div>
        <span className={LABEL}>Zones ciblées</span>
        <p className="text-muted text-[11px] leading-snug">
          Vide = bannière <b>visible partout</b>. Ajoutez une ou plusieurs zones
          (rayon autour d&apos;un point) → la bannière n&apos;apparaît
          qu&apos;aux utilisateurs situés dans l&apos;une d&apos;elles.
        </p>
      </div>

      {zones.length > 0 && (
        <ul className="space-y-1.5">
          {zones.map((z, i) => (
            <li
              key={i}
              className="border-border-strong flex items-center gap-2 rounded-[10px] border bg-white px-3 py-2 text-[12px]"
            >
              <MapPin className="text-primary-600 size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {z.label || `Zone ${i + 1}`}
                <span className="text-muted font-normal">
                  {" "}
                  · {z.radius_km} km · {z.center_lat.toFixed(3)},{" "}
                  {z.center_lng.toFixed(3)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onChange(zones.filter((_, j) => j !== i))}
                className="text-danger-600 hover:bg-danger-50 grid size-7 shrink-0 place-items-center rounded-[8px]"
                title="Retirer"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="border-border-strong space-y-2 rounded-[10px] border bg-white p-2.5">
          <p className="text-muted text-[11px]">
            Déplacez la carte / cherchez une adresse pour placer le centre de la
            zone, puis choisissez le rayon.
          </p>
          <MapPositionPicker
            initial={null}
            defaultCenter={{ lat: 36.7525, lng: 3.042 }}
            searchEnabled
            height={240}
            onChange={(p) => setCenter({ lat: p.lat, lng: p.lng })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL}>Rayon (km)</label>
              <input
                type="number"
                min={1}
                max={200}
                className={INPUT}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
            </div>
            <div>
              <label className={LABEL}>Nom (optionnel)</label>
              <input
                className={INPUT}
                value={label}
                maxLength={80}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex. Alger centre"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!center}
              onClick={add}
              className="bg-primary-600 hover:bg-primary-700 inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13px] font-bold text-white disabled:opacity-50"
            >
              <Plus className="size-4" /> Ajouter cette zone
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setCenter(null);
              }}
              className="border-border-strong text-muted hover:bg-surface-2 inline-flex h-9 items-center justify-center rounded-[10px] border px-3 text-[13px] font-semibold"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="border-primary-200 text-primary-700 hover:bg-primary-50 inline-flex h-9 items-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed px-3 text-[13px] font-bold"
        >
          <Plus className="size-4" /> Ajouter une zone
        </button>
      )}
    </div>
  );
}

/**
 * Sélecteur « offre commerçant » : recherche un commerçant ACTIF puis choisit
 * l'une de ses offres ACTIVES. La plateforme ne crée rien — elle pointe vers une
 * promotion existante. Si le commerçant n'a aucune offre active, on prévient
 * (la bannière resterait masquée).
 */
function MerchantOfferPicker({
  merchantId,
  merchantLabel,
  promotionId,
  onSelectMerchant,
  onSelectOffer,
}: {
  merchantId: string;
  merchantLabel: string;
  promotionId: string;
  onSelectMerchant: (id: string, label: string) => void;
  onSelectOffer: (o: OfferOption | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OfferMerchantOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);

  // Offres du commerçant sélectionné (rechargées à chaque changement d'id).
  useEffect(() => {
    if (!merchantId) {
      setOffers([]);
      return;
    }
    let cancelled = false;
    setLoadingOffers(true);
    void listMerchantOffers(merchantId)
      .then((os) => {
        if (!cancelled) setOffers(os);
      })
      .finally(() => {
        if (!cancelled) setLoadingOffers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  // Recherche commerçants (debounce) — seulement tant qu'aucun n'est choisi.
  useEffect(() => {
    if (merchantId) return;
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      void searchOfferMerchants(q)
        .then((r) => {
          if (!cancelled) setResults(r);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, merchantId]);

  return (
    <div className="border-border-strong space-y-3 rounded-[12px] border border-dashed p-3">
      <div>
        <span className={LABEL}>Offre mise en avant</span>
        <p className="text-muted text-[11px] leading-snug">
          Choisis un commerçant puis <b>une de ses offres actives</b>. Coligo ne
          crée pas l&apos;offre : elle est relue en direct. Si le commerçant la
          désactive, la bannière disparaît automatiquement.
        </p>
      </div>

      {!merchantId ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="text-muted pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
            <input
              className={cn(INPUT, "ps-9")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un commerçant…"
              autoFocus
            />
          </div>
          <ul className="border-border-strong max-h-64 divide-y overflow-y-auto rounded-[10px] border">
            {searching && results.length === 0 ? (
              <li className="text-muted flex items-center gap-2 px-3 py-3 text-sm">
                <Loader2 className="size-4 animate-spin" /> Recherche…
              </li>
            ) : results.length === 0 ? (
              <li className="text-muted px-3 py-3 text-sm">
                Aucun commerçant actif trouvé.
              </li>
            ) : (
              results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={m.active_offers === 0}
                    onClick={() =>
                      onSelectMerchant(
                        m.id,
                        m.commune ? `${m.name} · ${m.commune}` : m.name
                      )
                    }
                    className="hover:bg-surface-2 flex w-full items-center gap-2.5 px-3 py-2.5 text-start disabled:opacity-50"
                  >
                    <Store className="text-primary-600 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-semibold">
                        {m.name}
                      </span>
                      <span className="text-muted block truncate text-[11px]">
                        {[m.commune, m.wilaya_code]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
                        m.active_offers > 0
                          ? "bg-primary-50 text-primary-700"
                          : "bg-surface-2 text-muted"
                      )}
                    >
                      {m.active_offers > 0
                        ? `${m.active_offers} offre${m.active_offers > 1 ? "s" : ""}`
                        : "aucune offre"}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* Commerçant sélectionné */}
          <div className="border-primary-200 bg-primary-50 flex items-center gap-2 rounded-[10px] border px-3 py-2">
            <Store className="text-primary-700 size-4 shrink-0" />
            <span className="text-primary-800 min-w-0 flex-1 truncate text-sm font-bold">
              {merchantLabel || "Commerçant"}
            </span>
            <button
              type="button"
              onClick={() => {
                onSelectMerchant("", "");
                onSelectOffer(null);
                setQ("");
              }}
              className="text-primary-700 hover:bg-primary-100 inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] font-semibold"
            >
              <X className="size-3.5" /> Changer
            </button>
          </div>

          {/* Offres actives du commerçant */}
          {loadingOffers ? (
            <div className="text-muted flex items-center gap-2 px-1 py-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Chargement des offres…
            </div>
          ) : offers.length === 0 ? (
            <div className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] font-semibold text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Ce commerçant n&apos;a aucune offre active en ce moment. La
              bannière resterait masquée tant qu&apos;il n&apos;en publie pas.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {offers.map((o) => {
                const selected = o.id === promotionId;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => onSelectOffer(o)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-start transition-colors",
                        selected
                          ? "border-primary-600 bg-primary-50"
                          : "border-border-strong hover:bg-surface-2"
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-[8px]",
                          selected
                            ? "bg-primary-600 text-white"
                            : "bg-surface-2 text-muted"
                        )}
                      >
                        {selected ? (
                          <Check className="size-4" />
                        ) : (
                          <Ticket className="size-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground block truncate text-sm font-semibold">
                          {o.title_fr}
                        </span>
                        <span className="text-primary-700 block truncate text-[12px] font-bold">
                          {offerSummary(o)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function BannerForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  pending: boolean;
  onSubmit: (input: BannerInput) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploadErr(null);
    setUploading(true);
    try {
      const blob = await resizeImage(file);
      const fd = new FormData();
      fd.append("file", blob, "banner.jpg");
      const res = await uploadBannerImage(fd);
      if (res.error) setUploadErr(res.error);
      else if (res.url) {
        set("image_url", res.url);
        // À la 1re image, on bascule sur « pleine » si on était en texture.
        if (d.image_fit === "overlay") set("image_fit", "cover");
      }
    } catch {
      setUploadErr("Upload impossible. Réessayez.");
    } finally {
      setUploading(false);
    }
  };

  // Sélection commerçant → on repart d'une offre vierge.
  const handleSelectMerchant = (id: string, label: string) =>
    setD((prev) => ({
      ...prev,
      merchant_id: id,
      merchant_label: label,
      promotion_id: "",
      offer_summary: "",
    }));

  // Sélection d'une offre → mémorise + pré-remplit titre/CTA si vides.
  const handleSelectOffer = (o: OfferOption | null) =>
    setD((prev) =>
      o
        ? {
            ...prev,
            promotion_id: o.id,
            offer_summary: offerSummary(o),
            cta_label: prev.cta_label.trim() || suggestedCta(o),
            title: prev.title.trim() || o.title_fr,
          }
        : { ...prev, promotion_id: "", offer_summary: "" }
    );

  return (
    <div className="border-border-strong space-y-4 rounded-[14px] border bg-white p-4">
      {/* Aperçu live */}
      <div>
        <span className={LABEL}>Aperçu</span>
        <PreviewCard d={d} />
      </div>

      {/* Type de bannière */}
      <div>
        <span className={LABEL}>Type de bannière</span>
        <div className="grid grid-cols-2 gap-2">
          {[
            {
              value: "editorial" as const,
              label: "Éditoriale",
              hint: "Visuel + lien libre",
            },
            {
              value: "offer" as const,
              label: "Offre d'un commerçant",
              hint: "Met en avant une promo réelle",
            },
          ].map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => set("mode", m.value)}
              className={cn(
                "rounded-[10px] border px-3 py-2 text-start transition-colors",
                d.mode === m.value
                  ? "border-primary-600 bg-primary-50"
                  : "border-border-strong hover:bg-surface-2"
              )}
            >
              <span
                className={cn(
                  "block text-[13px] font-bold",
                  d.mode === m.value ? "text-primary-700" : "text-foreground"
                )}
              >
                {m.label}
              </span>
              <span className="text-muted block text-[11px]">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sélecteur d'offre (mode offre) — placé haut car il pilote le reste. */}
      {d.mode === "offer" && (
        <MerchantOfferPicker
          merchantId={d.merchant_id}
          merchantLabel={d.merchant_label}
          promotionId={d.promotion_id}
          onSelectMerchant={handleSelectMerchant}
          onSelectOffer={handleSelectOffer}
        />
      )}

      <div>
        <label className={LABEL}>Titre *</label>
        <input
          className={INPUT}
          value={d.title}
          maxLength={100}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Ex. Livraison offerte ce week-end"
        />
      </div>

      <div>
        <label className={LABEL}>Sous-titre</label>
        <input
          className={INPUT}
          value={d.subtitle}
          maxLength={200}
          onChange={(e) => set("subtitle", e.target.value)}
          placeholder="Ex. Sur toutes vos commandes en livraison"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Libellé du bouton</label>
          <input
            className={INPUT}
            value={d.cta_label}
            maxLength={50}
            onChange={(e) => set("cta_label", e.target.value)}
            placeholder="Ex. J'en profite"
          />
        </div>
        <div>
          <label className={LABEL}>Couleur</label>
          <select
            className={INPUT}
            value={d.accent}
            onChange={(e) =>
              set("accent", e.target.value as AdminBanner["accent"])
            }
          >
            {ACCENTS.map((a) => (
              <option key={a} value={a}>
                {ACCENT_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Lien libre : uniquement en mode éditorial. En mode offre, le clic
          ouvre la pop-up puis redirige vers la boutique (lien auto). */}
      {d.mode === "editorial" && (
        <div>
          <label className={LABEL}>Lien (au clic) — interne ou URL</label>
          <input
            className={INPUT}
            value={d.link}
            maxLength={500}
            onChange={(e) => set("link", e.target.value)}
            placeholder="Ex. /favoris  ou  https://…"
          />
        </div>
      )}

      {/* Image : upload (recommandé) + mode d'intégration */}
      <div className="border-border-strong space-y-3 rounded-[12px] border border-dashed p-3">
        <div>
          <label className={LABEL}>Image de la bannière (optionnel)</label>
          <p className="text-muted mb-2 text-[11px] leading-snug">
            Format conseillé : ~1200×600 px (paysage). Toute image, même grande,
            est automatiquement redimensionnée et intégrée au cadre — aucune
            déformation. PNG, JPG ou WEBP, 5 Mo max.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="border-primary-200 text-primary-700 hover:bg-primary-50 inline-flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border-[1.5px] px-3 text-sm font-bold">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              {d.image_url ? "Changer l'image" : "Téléverser une image"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  void onPickImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {d.image_url && (
              <button
                type="button"
                onClick={() => set("image_url", "")}
                className="text-danger-600 hover:bg-danger-50 inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold"
              >
                <Trash2 className="size-4" /> Retirer
              </button>
            )}
          </div>
          {uploadErr && (
            <p className="text-danger-700 mt-1.5 text-[12px] font-semibold">
              {uploadErr}
            </p>
          )}
          <input
            className={cn(INPUT, "mt-2")}
            value={d.image_url}
            maxLength={500}
            onChange={(e) => set("image_url", e.target.value)}
            placeholder="… ou collez une URL d'image"
          />
        </div>

        {d.image_url && (
          <div>
            <label className={LABEL}>Affichage de l&apos;image</label>
            <div className="grid grid-cols-3 gap-2">
              {FIT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => set("image_fit", o.value)}
                  className={cn(
                    "rounded-[10px] border px-2 py-2 text-[12px] font-bold transition-colors",
                    d.image_fit === o.value
                      ? "border-primary-600 bg-primary-50 text-primary-700"
                      : "border-border-strong text-muted hover:bg-surface-2"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-muted mt-1 text-[11px]">
              {FIT_OPTIONS.find((o) => o.value === d.image_fit)?.hint}
            </p>

            {/* Opacité réglable — seulement en mode « Texture de fond ». */}
            {d.image_fit === "overlay" && (
              <div className="mt-3">
                <label className={LABEL}>
                  Fondu de l&apos;image · {d.overlay_opacity}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={d.overlay_opacity}
                  onChange={(e) =>
                    set("overlay_opacity", Number(e.target.value))
                  }
                  className="accent-primary-600 h-2 w-full cursor-pointer"
                />
                <p className="text-muted mt-1 text-[11px]">
                  0 % = image invisible · 100 % = image bien visible sous le
                  texte. Défaut 30 %.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Début (optionnel)</label>
          <input
            type="datetime-local"
            className={INPUT}
            value={d.starts_at}
            onChange={(e) => set("starts_at", e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Fin (optionnel)</label>
          <input
            type="datetime-local"
            className={INPUT}
            value={d.ends_at}
            onChange={(e) => set("ends_at", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Ordre d&apos;affichage</label>
          <input
            type="number"
            min={0}
            max={9999}
            className={INPUT}
            value={d.position}
            onChange={(e) => set("position", Number(e.target.value))}
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={d.active}
            onChange={(e) => set("active", e.target.checked)}
            className="size-4"
          />
          Active (visible)
        </label>
      </div>

      {/* Ciblage géographique */}
      {d.mode === "editorial" ? (
        <ZonesEditor zones={d.zones} onChange={(z) => set("zones", z)} />
      ) : (
        <div className="border-border-strong space-y-2.5 rounded-[12px] border border-dashed p-3">
          <div>
            <span className={LABEL}>Ciblage géographique</span>
            <p className="text-muted flex items-start gap-1.5 text-[11px] leading-snug">
              <MapPin className="text-primary-600 mt-0.5 size-3.5 shrink-0" />
              <span>
                <b>Automatique</b> : la bannière suit la zone du commerçant.
                Elle n&apos;apparaît qu&apos;aux clients à portée (rayon autour
                du commerce, ou même wilaya à défaut de position GPS). Un client
                hors zone ne la voit pas.
              </span>
            </p>
          </div>
          <div>
            <label className={LABEL}>Rayon forcé (km) — optionnel</label>
            <input
              type="number"
              min={1}
              max={200}
              className={INPUT}
              value={d.geo_radius_km}
              onChange={(e) => set("geo_radius_km", e.target.value)}
              placeholder="Auto (portée de livraison du commerçant)"
            />
            <p className="text-muted mt-1 text-[11px]">
              Laisse vide pour utiliser la portée du commerçant. Renseigne une
              valeur pour élargir/restreindre la zone d&apos;affichage.
            </p>
          </div>
        </div>
      )}

      {d.mode === "offer" && !d.promotion_id && (
        <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
          Sélectionne un commerçant et une de ses offres pour enregistrer.
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={pending || (d.mode === "offer" && !d.promotion_id)}
          onClick={() => onSubmit(draftToInput(d))}
          className="bg-primary-600 hover:bg-primary-700 inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-4 text-sm font-bold text-white transition-colors disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Enregistrer
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-border-strong text-muted hover:bg-surface-2 inline-flex h-10 items-center justify-center rounded-[10px] border px-4 text-sm font-semibold"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
