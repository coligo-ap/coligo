"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { ActionButton } from "@/components/ui/action-button";
import { useConfirm } from "@/components/ui/confirm";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
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

      <Button type="button" onClick={() => setAdding(true)}>
        <Plus className="size-4" />
        {t("addAddress")}
      </Button>

      {/* ═══ PAGE DÉDIÉE PLEIN ÉCRAN — création d'adresse ═══ */}
      {adding && (
        <Portal>
          <div className="bg-surface-2 fixed inset-0 z-[100] flex flex-col pt-[env(safe-area-inset-top)]">
            <header className="border-border flex h-14 shrink-0 items-center gap-3 border-b bg-white px-3">
              <button
                type="button"
                onClick={() => setAdding(false)}
                aria-label={t("back")}
                className="bg-surface-2 grid size-9 place-items-center rounded-full transition-transform active:scale-90"
              >
                <ChevronLeft className="size-[18px] rtl:-scale-x-100" />
              </button>
              <h2 className="text-foreground flex-1 truncate text-base font-bold">
                {t("addAddress")}
              </h2>
            </header>

            <form action={action} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <AddressForm onChange={() => {}} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_default" />
                  {t("setAsDefault")}
                </label>
                {state.error && btnState === "error" && (
                  <p className="text-danger-600 text-sm">{state.error}</p>
                )}
              </div>
              <div className="border-border bg-surface shrink-0 border-t p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
                <ActionButton
                  type="submit"
                  className="w-full"
                  state={btnState}
                  labels={{
                    idle: t("save"),
                    pending: t("saving"),
                    success: t("addressSaved"),
                    error: t("errorRetry"),
                  }}
                />
              </div>
            </form>
          </div>
        </Portal>
      )}
    </div>
  );
}

function AddressRow({ addr }: { addr: Addr }) {
  const t = useTranslations("account");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [note, setNote] = useActionNote();
  return (
    <li className="border-border bg-surface rounded-[14px] border p-4">
      <div className="flex items-start gap-3">
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
                  if (r.error) {
                    setNote({ ok: false, text: r.error });
                    return;
                  }
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
            onClick={async () => {
              if (
                !(await confirm({
                  title: t("deleteAddressConfirm"),
                  confirmLabel: t("confirm"),
                  cancelLabel: t("cancel"),
                  danger: true,
                }))
              )
                return;
              start(async () => {
                const r = await deleteAddress(addr.id);
                if (r.error) {
                  setNote({ ok: false, text: r.error });
                  return;
                }
                router.refresh();
              });
            }}
            disabled={pending}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <ActionNote note={note} className="mt-2" />
    </li>
  );
}
