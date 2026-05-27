"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { MediaUpload } from "@/components/merchant/settings/media-upload";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";
import {
  setMediaUrl,
  updateProfile,
  type SettingsFormState,
} from "@/app/(merchant)/settings/actions";
import type { MerchantSettings } from "@/lib/types";

const SELECT_CLASS =
  "appearance-none flex h-10 w-full rounded-[10px] border border-border-strong bg-white pr-8 py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 disabled:cursor-not-allowed disabled:opacity-50";

const initial: SettingsFormState = {};

export function ProfileForm({ merchant }: { merchant: MerchantSettings }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateProfile, initial);
  // Sélecteur wilaya contrôlé pour que la liste de communes se recharge
  // quand la wilaya change. Default = valeur courante du commerçant.
  const [wilayaCode, setWilayaCode] = useState(merchant.wilaya_code ?? "");
  const communes = useMemo(() => getCommunes(wilayaCode), [wilayaCode]);
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
          <Field label="Wilaya">
            <div className="relative">
              <select
                name="wilaya_code"
                value={wilayaCode}
                onChange={(e) => setWilayaCode(e.target.value)}
                disabled={pending}
                className={SELECT_CLASS}
              >
                <option value="">— Sélectionner —</option>
                {WILAYAS.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
              <ChevronIcon />
            </div>
          </Field>
          <Field label="Commune">
            <div className="relative">
              {communes.length > 0 ? (
                <>
                  <select
                    name="commune"
                    defaultValue={merchant.commune ?? ""}
                    disabled={pending || !wilayaCode}
                    className={SELECT_CLASS}
                    // Key force le re-mount quand la wilaya change → reset
                    // automatique de la sélection si l'ancienne commune
                    // n'est plus valide dans la nouvelle wilaya.
                    key={wilayaCode}
                  >
                    <option value="">— Sélectionner —</option>
                    {communes.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <ChevronIcon />
                </>
              ) : (
                <Input
                  name="commune"
                  defaultValue={merchant.commune ?? ""}
                  maxLength={80}
                  disabled={pending}
                  placeholder={
                    wilayaCode
                      ? "Saisis ta commune"
                      : "Choisis d'abord une wilaya"
                  }
                />
              )}
            </div>
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
