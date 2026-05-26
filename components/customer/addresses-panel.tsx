"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { AddressForm } from "@/components/customer/address-picker";
import {
  addAddress,
  deleteAddress,
  setDefaultAddress,
  type AddressActionState,
} from "@/app/(customer)/adresses/actions";

type Addr = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  address_text: string | null;
  phone_override: string | null;
  is_default: boolean;
};

const initial: AddressActionState = {};

export function AddressesPanel({ addresses }: { addresses: Addr[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [state, action, pending] = useActionState(addAddress, initial);

  if (state.ok && adding) {
    // reset
    setTimeout(() => {
      setAdding(false);
      router.refresh();
    }, 0);
  }

  return (
    <div className="space-y-4">
      {addresses.length === 0 && !adding && (
        <p className="text-muted text-sm">
          Aucune adresse enregistrée pour l&apos;instant.
        </p>
      )}

      <ul className="space-y-3">
        {addresses.map((a) => (
          <AddressRow key={a.id} addr={a} />
        ))}
      </ul>

      {!adding ? (
        <Button type="button" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Ajouter une adresse
        </Button>
      ) : (
        <form
          action={action}
          className="border-border bg-surface space-y-4 rounded-[14px] border p-4"
        >
          <AddressForm onChange={() => {}} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_default" />
            Définir comme adresse par défaut
          </label>
          {state.error && (
            <p className="text-danger-600 text-sm">{state.error}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAdding(false)}
              disabled={pending}
            >
              Annuler
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function AddressRow({ addr }: { addr: Addr }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="border-border bg-surface flex items-start gap-3 rounded-[14px] border p-4">
      <MapPin className="text-primary-600 mt-0.5 size-5" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {addr.label}
          {addr.is_default && (
            <span className="bg-success-100 text-success-700 rounded-full px-2 py-0.5 text-xs">
              Par défaut
            </span>
          )}
        </p>
        {addr.address_text && (
          <p className="text-muted mt-0.5 text-xs">{addr.address_text}</p>
        )}
        <p className="text-subtle mt-0.5 text-xs tabular-nums">
          {addr.lat.toFixed(5)}, {addr.lng.toFixed(5)}
          {addr.phone_override ? ` · ${addr.phone_override}` : ""}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        {!addr.is_default && (
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() =>
              start(async () => {
                const r = await setDefaultAddress(addr.id);
                if (r.error) toast.error(r.error);
                router.refresh();
              })
            }
            disabled={pending}
          >
            <Star className="size-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          type="button"
          variant="secondary"
          onClick={() => {
            if (!confirm("Supprimer cette adresse ?")) return;
            start(async () => {
              const r = await deleteAddress(addr.id);
              if (r.error) toast.error(r.error);
              router.refresh();
            });
          }}
          disabled={pending}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}
