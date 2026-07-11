"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeSocialSignup, type AuthState } from "@/app/(merchant)/actions";
import { CategoryMultiSelect } from "@/components/merchant/settings/category-multi-select";
import { Store, ArrowRight, UserRound } from "lucide-react";
import { ShopLocationPicker } from "@/components/shared/shop-location-picker";

const initialState: AuthState = {};

/**
 * Formulaire BOUTIQUE seul (après connexion Google) — mêmes champs que
 * /signup sans email ni mot de passe. Soumis à `completeSocialSignup`.
 */
export function CompleteShopForm() {
  const [state, formAction, pending] = useActionState(
    completeSocialSignup,
    initialState
  );
  const [cats, setCats] = useState<string[]>([]);
  const [locationValid, setLocationValid] = useState(false);

  return (
    <form action={formAction} className="space-y-3">
      {/* Nom commerce */}
      <div className="space-y-1.5">
        <Label htmlFor="merchantName">
          Nom du commerce <span className="text-rose-600">*</span>
        </Label>
        <div className="relative">
          <Store className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="merchantName"
            name="merchantName"
            type="text"
            placeholder="Boulangerie El Karim"
            required
            disabled={pending}
            className="pl-9"
          />
        </div>
      </div>

      {/* Nom & prénom du responsable */}
      <div className="space-y-1.5">
        <Label htmlFor="managerName">
          Nom & prénom du responsable <span className="text-rose-600">*</span>
        </Label>
        <div className="relative">
          <UserRound className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="managerName"
            name="managerName"
            type="text"
            placeholder="Karim Benali"
            required
            disabled={pending}
            className="pl-9"
          />
        </div>
      </div>

      {/* Types de commerce (multi-sélection cherchable) */}
      <div className="space-y-1.5">
        <Label>Types de commerce</Label>
        <CategoryMultiSelect
          value={cats}
          onChange={setCats}
          disabled={pending}
        />
        <p className="text-subtle text-xs">
          Plusieurs types possibles — le premier est votre type principal.
        </p>
      </div>

      {/* Emplacement de la boutique — wilaya + commune → carte focalisée →
          position exacte confirmée + adresse. */}
      <ShopLocationPicker
        names={{
          wilaya: "wilayaCode",
          commune: "city",
          address: "address",
          lat: "latitude",
          lng: "longitude",
        }}
        initial={{ wilayaCode: "16" }}
        disabled={pending}
        requireConfirm
        onValidityChange={setLocationValid}
      />

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
          "Création…"
        ) : (
          <>
            Créer ma boutique
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>
      {!locationValid && (
        <p className="text-subtle text-center text-xs">
          Choisis ta wilaya et ta commune, puis confirme la position exacte de
          ta boutique sur la carte.
        </p>
      )}
    </form>
  );
}
