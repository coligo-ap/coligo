"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { MediaUpload } from "@/components/merchant/settings/media-upload";
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
            <Input
              name="category"
              defaultValue={merchant.category ?? ""}
              maxLength={60}
              placeholder="Ex. Boulangerie, Pâtisserie…"
              disabled={pending}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code wilaya">
            <Input
              name="wilaya_code"
              defaultValue={merchant.wilaya_code ?? ""}
              maxLength={2}
              placeholder="Ex. 16"
              disabled={pending}
            />
          </Field>
          <Field label="Commune">
            <Input
              name="commune"
              defaultValue={merchant.commune ?? ""}
              maxLength={80}
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
        </div>

        <Field label="Adresse">
          <Input
            name="address"
            defaultValue={merchant.address ?? ""}
            maxLength={200}
            placeholder="Numéro, rue, quartier…"
            disabled={pending}
          />
        </Field>

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
