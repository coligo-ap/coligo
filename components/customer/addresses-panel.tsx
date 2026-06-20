"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapPin, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
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
  const t = useTranslations("account");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [state, action, pending] = useActionState(addAddress, initial);
  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  // Quand l'enregistrement réussit, on attend ~1s (pour que l'utilisateur
  // voie "Enregistré ✓") puis on ferme le form et on refresh.
  useEffect(() => {
    if (state.ok && adding && !pending) {
      const t = setTimeout(() => {
        setAdding(false);
        router.refresh();
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [state.ok, adding, pending, router]);

  return (
    <div className="space-y-4">
      {addresses.length === 0 && !adding && (
        <p className="text-muted text-sm">{t("noAddressesYet")}</p>
      )}

      <ul className="space-y-3">
        {addresses.map((a) => (
          <AddressRow key={a.id} addr={a} />
        ))}
      </ul>

      {!adding ? (
        <Button type="button" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t("addAddress")}
        </Button>
      ) : (
        <form
          action={action}
          className="border-border bg-surface space-y-4 rounded-[14px] border p-4"
        >
          <AddressForm onChange={() => {}} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_default" />
            {t("setAsDefault")}
          </label>
          {state.error && btnState === "error" && (
            <p className="text-danger-600 text-sm">{state.error}</p>
          )}
          <div className="flex gap-2">
            <ActionButton
              type="submit"
              state={btnState}
              labels={{
                idle: t("save"),
                pending: t("saving"),
                success: t("addressSaved"),
                error: t("errorRetry"),
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAdding(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function AddressRow({ addr }: { addr: Addr }) {
  const t = useTranslations("account");
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
              {t("default")}
            </span>
          )}
        </p>
        {/* Partie B : on n'affiche JAMAIS le GPS brut — l'adresse lisible suffit
            (repli neutre si aucune adresse résolue). Le téléphone alternatif
            reste utile pour le livreur. */}
        <p className="text-muted mt-0.5 text-xs">
          {addr.address_text || t("mapPoint")}
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
            if (!confirm(t("deleteAddressConfirm"))) return;
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
