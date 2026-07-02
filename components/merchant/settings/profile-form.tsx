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
import { createClient } from "@/lib/supabase/client";
import { CategoryMultiSelect } from "@/components/merchant/settings/category-multi-select";
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
  // PHASE 2 multi-catégories : sélection multiple (la 1re = principale, pilote
  // aussi la liste de tags). Initialisée avec la principale, complétée par les
  // liaisons existantes (lecture RLS owner).
  const [cats, setCats] = useState<string[]>(
    merchant.category ? [merchant.category] : []
  );
  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("merchant_category_links" as never)
      .select("code")
      .eq("merchant_id", merchant.id)
      .then(({ data }) => {
        const linked = ((data ?? []) as unknown as { code: string }[]).map(
          (r) => r.code
        );
        if (linked.length === 0) return;
        setCats((cur) => [...cur, ...linked.filter((c) => !cur.includes(c))]);
      });
  }, [merchant.id]);
  const category = cats[0] ?? "";
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
          <Field label="Types de commerce (multi)">
            <CategoryMultiSelect
              value={cats}
              onChange={setCats}
              disabled={pending}
              currentCodes={cats}
            />
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
