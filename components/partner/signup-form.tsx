"use client";

import { useActionState, useState } from "react";
import { ArrowRight, FileText, Phone, Store, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShopLocationPicker } from "@/components/shared/shop-location-picker";
import { partnerSignup, type PartnerAuthState } from "@/app/(partner)/actions";

const initial: PartnerAuthState = {};

/**
 * Auto-inscription Agent Coligo Pay : infos du point + gérant + registre de
 * commerce + emplacement GPS (carte). Les PIÈCES (RC, identité) sont déposées
 * juste après, depuis l'espace agent (« Mon dossier »). Soumission gatée par la
 * validité de l'emplacement ; verrou ref anti double-soumission.
 */
export function PartnerSignupForm() {
  const [state, action, pending] = useActionState(partnerSignup, initial);
  const [locationValid, setLocationValid] = useState(false);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="displayName">
          Nom du point de recharge <span className="text-rose-600">*</span>
        </Label>
        <div className="relative">
          <Store className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="displayName"
            name="displayName"
            type="text"
            placeholder="Alimentation El Baraka"
            required
            disabled={pending}
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ownerName">
          Nom &amp; prénom du gérant <span className="text-rose-600">*</span>
        </Label>
        <div className="relative">
          <UserRound className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="ownerName"
            name="ownerName"
            type="text"
            placeholder="Karim Benali"
            required
            disabled={pending}
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="registreCommerce">
          N° de registre de commerce <span className="text-rose-600">*</span>
        </Label>
        <div className="relative">
          <FileText className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="registreCommerce"
            name="registreCommerce"
            type="text"
            placeholder="RC 16/00-1234567 B 24"
            required
            disabled={pending}
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="hours">Horaires (optionnel)</Label>
        <Input
          id="hours"
          name="hours"
          type="text"
          placeholder="08h – 20h, tous les jours"
          disabled={pending}
        />
      </div>

      {/* Emplacement du point (wilaya + commune + carte) — requis. */}
      <ShopLocationPicker
        names={{
          wilaya: "wilaya",
          commune: "commune",
          address: "address",
          lat: "lat",
          lng: "lng",
        }}
        initial={{ wilayaCode: "16" }}
        disabled={pending}
        requireConfirm
        onValidityChange={setLocationValid}
      />

      {/* Identifiants de connexion */}
      <div className="border-surface-3 space-y-3 border-t pt-4">
        <div className="space-y-1.5">
          <Label htmlFor="phone">
            Téléphone <span className="text-rose-600">*</span>
          </Label>
          <div className="relative">
            <Phone className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="07 / 06 / 05 XX XX XX XX"
              required
              disabled={pending}
              className="pl-9"
            />
          </div>
          <p className="text-subtle text-xs">
            Ce numéro vous servira d&apos;identifiant de connexion.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">
            Mot de passe <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={6}
            placeholder="Au moins 6 caractères"
            required
            disabled={pending}
          />
        </div>
      </div>

      {state.error && (
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {state.error}
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || !locationValid}
      >
        {pending ? (
          "Envoi de la demande…"
        ) : (
          <>
            Envoyer ma demande
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>

      <p className="text-subtle text-center text-xs">
        Votre demande sera examinée par Coligo. Vous ajouterez vos documents
        (registre de commerce, pièce d&apos;identité) juste après.
      </p>
    </form>
  );
}
