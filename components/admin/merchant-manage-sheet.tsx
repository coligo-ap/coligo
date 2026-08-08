"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import type { AdminMerchant } from "@/lib/data/platform";
import {
  adminUpdateMerchant,
  getMerchantFullForAdmin,
  type MerchantPatch,
} from "@/app/admin/merchants/manage-actions";

// =============================================================================
// FICHE COMMERÇANT — édition complète par l'équipe Coligo (mig 0430).
//
// Découpée en SECTIONS repliées : une fiche complète ouverte d'un bloc, c'est
// trente champs sous les yeux et une erreur de saisie qui attend. On ouvre la
// section qu'on vient corriger.
//
// On n'envoie que les champs RÉELLEMENT modifiés : un champ qu'on n'a pas
// touché ne doit jamais partir dans la requête (sinon un formulaire pré-rempli
// à moitié écraserait des valeurs qu'on n'a jamais vues).
// =============================================================================

type Draft = Record<string, string | boolean | null>;

export function MerchantManageSheet({
  merchant,
  onClose,
  onSaved,
}: {
  merchant: AdminMerchant & Record<string, unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({});
  // Fiche COMPLÈTE chargée à l'ouverture : l'annuaire est volontairement
  // léger, il ne porte pas l'adresse, les horaires ni les réglages livraison.
  const [full, setFull] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    void getMerchantFullForAdmin(merchant.id).then(setFull);
  }, [merchant.id]);
  const [open, setOpen] = useState<string | null>("identite");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Ordre de lecture : brouillon en cours > fiche complète > annuaire.
  const src = (k: string, fallback: unknown): unknown =>
    full && k in full ? full[k] : fallback;
  const val = (k: string, fallback: unknown): string => {
    if (draft[k] !== undefined) return String(draft[k] ?? "");
    const v = src(k, fallback);
    return v == null ? "" : String(v);
  };
  const bool = (k: string, fallback: unknown): boolean =>
    draft[k] !== undefined ? Boolean(draft[k]) : Boolean(src(k, fallback));
  const set = (k: string, v: string | boolean | null) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    setErr(null);
    const patch: MerchantPatch = {};
    for (const [k, v] of Object.entries(draft)) {
      if (typeof v === "boolean") {
        (patch as Record<string, unknown>)[k] = v;
      } else if (["latitude", "longitude", "delivery_radius_km"].includes(k)) {
        (patch as Record<string, unknown>)[k] = v === "" ? null : Number(v);
      } else if (["prep_time_min", "min_order_da"].includes(k)) {
        (patch as Record<string, unknown>)[k] =
          v === "" ? null : Math.round(Number(v));
      } else {
        (patch as Record<string, unknown>)[k] = v === "" ? null : v;
      }
    }
    startTransition(async () => {
      const res = await adminUpdateMerchant(merchant.id, patch);
      if (res.error) {
        setErr(res.error);
        return;
      }
      onSaved();
      onClose();
    });
  };

  const dirty = Object.keys(draft).length;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/45 sm:items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-t-sheet-xl sm:rounded-sheet-xl max-h-[92dvh] w-full max-w-[560px] overflow-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-foreground text-title-lg truncate font-extrabold">
              {merchant.name}
            </h2>
            <p className="text-muted truncate text-xs">
              Fiche complète — les taux et l&apos;approbation gardent leurs
              écrans dédiés.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-muted grid size-8 shrink-0 place-items-center rounded-full"
          >
            <X className="size-4" />
          </button>
        </div>

        <Section id="identite" title="Identité" open={open} setOpen={setOpen}>
          <Field
            label="Nom"
            value={val("name", merchant.name)}
            onChange={(v) => set("name", v)}
          />
          <Field
            label="Identifiant (slug)"
            value={val("slug", merchant.slug)}
            onChange={(v) => set("slug", v)}
          />
          <Field
            label="Responsable"
            value={val("manager_name", merchant.manager_name)}
            onChange={(v) => set("manager_name", v)}
          />
          <Field
            label="Téléphone public"
            value={val("phone_public", merchant.phone)}
            onChange={(v) => set("phone_public", v)}
          />
          <Field
            label="Description (FR)"
            value={val("description_fr", merchant.description_fr)}
            onChange={(v) => set("description_fr", v)}
            textarea
          />
          <Field
            label="Description (AR)"
            value={val("description_ar", merchant.description_ar)}
            onChange={(v) => set("description_ar", v)}
            textarea
          />
        </Section>

        <Section
          id="visuels"
          title="Logo et couverture"
          open={open}
          setOpen={setOpen}
        >
          <Visual
            label="Logo"
            url={val("logo_url", merchant.logo_url)}
            onChange={(v) => set("logo_url", v)}
          />
          <Visual
            label="Photo de couverture"
            url={val("cover_url", merchant.cover_url)}
            onChange={(v) => set("cover_url", v)}
          />
          <p className="text-subtle text-caption">
            Collez l&apos;adresse d&apos;une image, ou piochez dans la banque
            d&apos;images depuis l&apos;onglet « Visuels ».
          </p>
        </Section>

        <Section
          id="lieu"
          title="Adresse et position"
          open={open}
          setOpen={setOpen}
        >
          <Field
            label="Adresse"
            value={val("address", merchant.address)}
            onChange={(v) => set("address", v)}
          />
          <Field
            label="Commune"
            value={val("commune", merchant.commune)}
            onChange={(v) => set("commune", v)}
          />
          <Field
            label="Ville"
            value={val("city", merchant.city)}
            onChange={(v) => set("city", v)}
          />
          <Field
            label="Code wilaya"
            value={val("wilaya_code", merchant.wilaya_code)}
            onChange={(v) => set("wilaya_code", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Latitude"
              value={val("latitude", merchant.latitude)}
              onChange={(v) => set("latitude", v)}
            />
            <Field
              label="Longitude"
              value={val("longitude", merchant.longitude)}
              onChange={(v) => set("longitude", v)}
            />
          </div>
        </Section>

        <Section
          id="livraison"
          title="Livraison et commandes"
          open={open}
          setOpen={setOpen}
        >
          <Toggle
            label="Livraison activée"
            on={bool("delivery_enabled", merchant.delivery_enabled)}
            onChange={(v) => set("delivery_enabled", v)}
          />
          <Toggle
            label="Express"
            on={bool("express_enabled", merchant.express_enabled)}
            onChange={(v) => set("express_enabled", v)}
          />
          <Toggle
            label="Tournées"
            on={bool("tours_enabled", merchant.tours_enabled)}
            onChange={(v) => set("tours_enabled", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Rayon (km)"
              value={val("delivery_radius_km", merchant.delivery_radius_km)}
              onChange={(v) => set("delivery_radius_km", v)}
            />
            <Field
              label="Panier min. (DA)"
              value={val("min_order_da", merchant.min_order_da)}
              onChange={(v) => set("min_order_da", v)}
            />
          </div>
          <Field
            label="Préparation (min)"
            value={val("prep_time_min", merchant.prep_time_min)}
            onChange={(v) => set("prep_time_min", v)}
          />
          <Toggle
            label="Espèces acceptées"
            on={bool("accepts_cash", merchant.accepts_cash)}
            onChange={(v) => set("accepts_cash", v)}
          />
          <Toggle
            label="Paiement en ligne"
            on={bool("accepts_online", merchant.accepts_online)}
            onChange={(v) => set("accepts_online", v)}
          />
          <Toggle
            label="Acceptation automatique"
            on={bool("auto_accept_orders", merchant.auto_accept_orders)}
            onChange={(v) => set("auto_accept_orders", v)}
          />
        </Section>

        <Section id="etat" title="État du compte" open={open} setOpen={setOpen}>
          <Toggle
            label="Compte actif"
            on={bool("is_active", merchant.is_active)}
            onChange={(v) => set("is_active", v)}
          />
          <Toggle
            label="Gelé"
            on={bool("is_frozen", merchant.is_frozen)}
            onChange={(v) => set("is_frozen", v)}
          />
          <Toggle
            label="Commandes en pause"
            on={bool("orders_paused", merchant.orders_paused)}
            onChange={(v) => set("orders_paused", v)}
          />
        </Section>

        {err && (
          <p className="text-danger-700 mt-3 text-sm font-medium">{err}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-border text-foreground flex-1 rounded-md border px-4 py-2.5 text-sm font-semibold"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || dirty === 0}
            className="bg-primary-600 hover:bg-primary-700 flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-extrabold text-white transition-colors disabled:opacity-50"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {dirty === 0
              ? "Aucune modification"
              : `Enregistrer (${dirty} champ${dirty > 1 ? "s" : ""})`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── briques ───────────────────────────── */

function Section({
  id,
  title,
  open,
  setOpen,
  children,
}: {
  id: string;
  title: string;
  open: string | null;
  setOpen: (v: string | null) => void;
  children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div className="border-border mb-2 rounded-md border">
      <button
        type="button"
        onClick={() => setOpen(isOpen ? null : id)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
      >
        <span className="text-foreground text-sm font-bold">{title}</span>
        <ChevronDown
          className={`text-muted size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && <div className="space-y-2.5 px-3.5 pb-3.5">{children}</div>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-muted text-caption mb-1 block font-semibold">
        {label}
      </span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="border-border bg-surface text-foreground rounded-control w-full border px-3 py-2 text-sm"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border-border bg-surface text-foreground rounded-control w-full border px-3 py-2 text-sm"
        />
      )}
    </label>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="border-border rounded-control flex w-full items-center justify-between gap-3 border px-3 py-2.5 text-left"
    >
      <span className="text-foreground text-sm font-semibold">{label}</span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary-600" : "bg-surface-2 border-border border"}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

/** Visuel : aperçu + champ d'adresse — on voit ce qu'on met. */
function Visual({
  label,
  url,
  onChange,
}: {
  label: string;
  url: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className="text-muted text-caption mb-1 block font-semibold">
        {label}
      </span>
      <div className="flex items-center gap-2.5">
        <span className="bg-surface-2 border-border rounded-control size-14 shrink-0 overflow-hidden border">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-full object-cover" />
          ) : null}
        </span>
        <input
          value={url}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          className="border-border bg-surface text-foreground rounded-control min-w-0 flex-1 border px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
