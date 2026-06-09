"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { updateDriverProfile } from "@/app/admin/drivers/actions";
import type { AdminFormState } from "@/app/admin/actions";

export type DriverProfile = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  wilaya: string | null;
  address: string | null;
  date_of_birth: string | null;
  national_id_number: string | null;
  id_card_number: string | null;
  vehicle_type: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_year: number | null;
  vehicle_plate: string | null;
  admin_note: string | null;
};

const VEHICLE_TYPES = [
  ["moto", "Moto"],
  ["scooter", "Scooter"],
  ["velo", "Vélo"],
  ["voiture", "Voiture"],
  ["camionnette", "Camionnette"],
] as const;

export function DriverProfileForm({ driver }: { driver: DriverProfile }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    updateDriverProfile.bind(null, driver.id),
    {}
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Profil mis à jour");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-muted mb-1 text-xs font-semibold uppercase">
          Identité
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Nom & prénom"
            name="full_name"
            defaultValue={driver.full_name}
            required
          />
          <Field
            label="Téléphone"
            name="phone"
            defaultValue={driver.phone}
            required
          />
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={driver.email}
          />
          <Field label="Wilaya" name="wilaya" defaultValue={driver.wilaya} />
          <Field label="Adresse" name="address" defaultValue={driver.address} />
          <Field
            label="Date de naissance"
            name="date_of_birth"
            type="date"
            defaultValue={driver.date_of_birth}
          />
          <Field
            label="N° carte d'identité"
            name="id_card_number"
            defaultValue={driver.id_card_number}
          />
          <Field
            label="N° national"
            name="national_id_number"
            defaultValue={driver.national_id_number}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-muted mb-1 text-xs font-semibold uppercase">
          Véhicule
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="vehicle_type" className="mb-1 block text-xs">
              Type
            </Label>
            <select
              id="vehicle_type"
              name="vehicle_type"
              defaultValue={driver.vehicle_type ?? ""}
              className="border-border bg-surface h-10 w-full rounded-[10px] border px-3 text-sm"
            >
              <option value="">—</option>
              {VEHICLE_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Immatriculation"
            name="vehicle_plate"
            defaultValue={driver.vehicle_plate}
          />
          <Field
            label="Marque"
            name="vehicle_brand"
            defaultValue={driver.vehicle_brand}
          />
          <Field
            label="Modèle"
            name="vehicle_model"
            defaultValue={driver.vehicle_model}
          />
          <Field
            label="Couleur"
            name="vehicle_color"
            defaultValue={driver.vehicle_color}
          />
          <Field
            label="Année"
            name="vehicle_year"
            type="number"
            defaultValue={driver.vehicle_year?.toString() ?? null}
          />
        </div>
      </fieldset>

      <div>
        <Label htmlFor="admin_note" className="mb-1 block text-xs">
          Note interne (non visible par le livreur)
        </Label>
        <textarea
          id="admin_note"
          name="admin_note"
          defaultValue={driver.admin_note ?? ""}
          rows={2}
          className="border-border bg-surface w-full rounded-[10px] border px-3 py-2 text-sm"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Enregistrer le profil
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  defaultValue: string | null;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={name} className="mb-1 block text-xs">
        {label}
        {required && <span className="text-danger-600"> *</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
      />
    </div>
  );
}
