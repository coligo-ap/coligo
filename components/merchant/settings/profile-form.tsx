"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { MediaUpload } from "@/components/merchant/settings/media-upload";
import { ShopLocationPicker } from "@/components/shared/shop-location-picker";
import { TagsPicker } from "@/components/merchant/settings/tags-picker";
import { useCategories } from "@/lib/hooks/use-categories";
import {
  setMediaUrl,
  updateProfile,
  type SettingsFormState,
} from "@/app/(merchant)/settings/actions";
import type { MerchantSettings } from "@/lib/types";

const initial: SettingsFormState = {};

export function ProfileForm({ merchant }: { merchant: MerchantSettings }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateProfile, initial);
  // Catégorie en state → pilote la liste de tags proposée (TagsPicker).
  const [category, setCategory] = useState(merchant.category ?? "");
  // Catégories pilotées en base (statuts admin) : masquées exclues SAUF la
  // catégorie actuelle du commerçant (il doit pouvoir la conserver).
  const allCategories = useCategories();
  const categoriesForSelect = allCategories.filter(
    (c) => c.status !== "hidden" || c.code === category
  );
  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  useEffect(() => {
    // Refresh sur succès — pas de toast (feedback sur le bouton)
    if (state.ok && !pending) router.refresh();
  }, [state.ok, pending, router]);

  return (
    <div className="space-y-6">
      {/* Logo + cover */}
      <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
        <div>
          <Label className="mb-2 block">Logo</Label>
          <MediaUpload
            merchantId={merchant.id}
            bucket="merchant-logos"
            initialUrl={merchant.logo_url}
            variant="logo"
            onPersistUrl={(url) => setMediaUrl("logo_url", url)}
          />
        </div>
        <div>
          <Label className="mb-2 block">Image de couverture</Label>
          <MediaUpload
            merchantId={merchant.id}
            bucket="merchant-covers"
            initialUrl={merchant.cover_url}
            variant="cover"
            onPersistUrl={(url) => setMediaUrl("cover_url", url)}
          />
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom de la boutique" required>
            <Input
              name="name"
              defaultValue={merchant.name}
              required
              maxLength={80}
              disabled={pending}
            />
          </Field>
          <Field label="Catégorie">
            <div className="relative">
              <select
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={pending}
                className="border-border-strong focus:ring-primary-400 focus:border-primary-400 flex h-10 w-full appearance-none rounded-[10px] border bg-white py-2 pr-8 pl-3 text-sm focus:ring-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">— Sélectionner une catégorie —</option>
                {categoriesForSelect.map((c) => (
                  <option
                    key={c.code}
                    value={c.code}
                    disabled={c.status === "coming_soon" && c.code !== category}
                  >
                    {c.emoji} {c.label}
                    {c.status === "coming_soon" ? " — bientôt disponible" : ""}
                  </option>
                ))}
              </select>
              <ChevronIcon />
            </div>
          </Field>
        </div>

        <Field label="Spécialités (tags)">
          <TagsPicker
            category={category || null}
            initialTags={merchant.tags ?? []}
            disabled={pending}
          />
        </Field>

        <Field label="Téléphone public">
          <Input
            name="phone_public"
            defaultValue={merchant.phone_public ?? ""}
            placeholder="+213 …"
            disabled={pending}
          />
        </Field>

        {/* Emplacement de la boutique — wilaya + commune + position exacte sur
            carte + adresse enregistrée. C'est ICI qu'on regarde le commerce
            exactement : on affiche l'adresse réelle enregistrée, pas seulement
            le repère par défaut. */}
        <div className="border-border bg-surface-2/40 space-y-3 rounded-[14px] border p-4">
          <div className="flex items-center gap-2">
            <MapPin className="text-primary-600 size-4" />
            <h3 className="text-foreground text-sm font-semibold">
              Emplacement de la boutique
            </h3>
          </div>
          {merchant.address && (
            <p className="text-muted text-xs">
              Adresse enregistrée :{" "}
              <span className="text-foreground font-medium">
                {merchant.address}
              </span>
            </p>
          )}
          <ShopLocationPicker
            names={{
              wilaya: "wilaya_code",
              commune: "commune",
              address: "address",
              lat: "latitude",
              lng: "longitude",
            }}
            initial={{
              wilayaCode: merchant.wilaya_code,
              commune: merchant.commune,
              address: merchant.address,
              lat: merchant.latitude,
              lng: merchant.longitude,
            }}
            disabled={pending}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Description (français)">
            <textarea
              name="description_fr"
              defaultValue={merchant.description_fr ?? ""}
              rows={4}
              maxLength={800}
              disabled={pending}
              className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-[12px] border px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            />
          </Field>
          <Field label="Description (arabe)">
            <textarea
              name="description_ar"
              defaultValue={merchant.description_ar ?? ""}
              rows={4}
              maxLength={800}
              dir="rtl"
              disabled={pending}
              className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-[12px] border px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            />
          </Field>
        </div>

        {state.error && btnState === "error" && (
          <p className="text-danger-600 text-sm">{state.error}</p>
        )}

        <div className="flex items-center gap-3">
          <ActionButton
            type="submit"
            state={btnState}
            labels={{
              idle: "Enregistrer le profil",
              pending: "Enregistrement…",
              success: "Profil enregistré ✓",
              error: "Erreur, réessaie",
            }}
          />
          <span className="text-subtle text-xs">
            Slug actuel : <code className="font-mono">{merchant.slug}</code>
          </span>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="text-subtle pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
