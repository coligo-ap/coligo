"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Loader2,
  Search,
  SlidersHorizontal,
  Store,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { cn } from "@/lib/utils";
import {
  adminGetMerchantLoyaltyProgram,
  adminSearchLoyaltyMerchants,
  adminUpdateMerchantLoyaltyProgram,
  type LoyaltyMerchantHit,
  type MerchantProgramValues,
  type RemoteProgramResult,
} from "@/app/admin/merchants/fidelite/actions";

/**
 * Sélecteur de commerçant RECHERCHE D'ABORD (règle annuaires du repo) : rien
 * n'est chargé en masse — échantillon des 3 derniers sans saisie, puis
 * ilike nom / téléphone / ville / email côté SQL (mig 0458).
 */
export function LoyaltyMerchantPicker({
  selected,
  onSelect,
}: {
  selected: LoyaltyMerchantHit | null;
  onSelect: (m: LoyaltyMerchantHit | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LoyaltyMerchantHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  function runSearch(q: string) {
    const mySeq = ++seq.current;
    setSearching(true);
    void adminSearchLoyaltyMerchants(q).then((rows) => {
      if (seq.current !== mySeq) return; // réponse périmée
      setHits(rows);
      setSearching(false);
      setOpen(true);
    });
  }

  function onChange(q: string) {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(q), 300);
  }

  if (selected) {
    return (
      <div className="border-primary-200 bg-primary-50 flex items-center gap-3 rounded-md border p-3">
        <Store className="text-primary-600 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{selected.name}</p>
          <p className="text-muted truncate text-xs">
            {[selected.city, selected.email].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-muted hover:text-foreground flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold"
        >
          <X className="size-3.5" />
          Changer
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="text-subtle absolute start-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => runSearch(query)}
          placeholder="Nom, téléphone, ville ou email du commerçant…"
          className="ps-9"
        />
        {searching && (
          <Loader2 className="text-subtle absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin" />
        )}
      </div>
      {open && (
        <div className="border-border bg-surface absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border">
          {hits.length === 0 ? (
            <p className="text-muted px-3 py-3 text-sm">
              {searching ? "Recherche…" : "Aucun commerçant trouvé."}
            </p>
          ) : (
            hits.map((m) => (
              <button
                key={m.id}
                type="button"
                onMouseDown={(e) => {
                  // pointerdown avant le blur de l'input (piège dropdowns).
                  e.preventDefault();
                  setOpen(false);
                  onSelect(m);
                }}
                className="hover:bg-surface-2 flex w-full items-center gap-2.5 px-3 py-2.5 text-start"
              >
                <Store className="text-primary-600 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {m.name}
                    {!m.approved && (
                      <span className="text-warning-700 ms-1.5 text-xs font-semibold">
                        · en attente
                      </span>
                    )}
                  </span>
                  <span className="text-muted block truncate text-xs">
                    {[m.city, m.phone, m.email].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {m.has_program && (
                  <span
                    className={cn(
                      "text-micro rounded-full px-2 py-0.5 font-bold",
                      m.program_enabled
                        ? "bg-success-50 text-success-700"
                        : "bg-surface-3 text-muted"
                    )}
                  >
                    {m.program_enabled ? "Programme actif" : "Programme off"}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const initialRemote: RemoteProgramResult = {};

/**
 * PILOTAGE À DISTANCE : le super-admin lit et modifie le programme du
 * commerçant sélectionné (intervention rapide support) — mêmes bornes que le
 * commerçant, trace admin_audit_log avant/après.
 */
export function RemoteProgramPanel({
  merchant,
}: {
  merchant: LoyaltyMerchantHit;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    adminUpdateMerchantLoyaltyProgram,
    initialRemote
  );
  const fb = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<MerchantProgramValues | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [tierOn, setTierOn] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void adminGetMerchantLoyaltyProgram(merchant.id).then((res) => {
      if (!alive) return;
      const p = res.program ?? null;
      setValues(
        p ?? {
          enabled: false,
          earn_rate_pct: 5,
          tier_threshold_da: 2000,
          tier_reward_da: 200,
          voucher_validity_days: 90,
          daily_credit_cap_da: 1000,
          link_bonus_da: 0,
        }
      );
      setEnabled(p?.enabled ?? false);
      setTierOn(p ? p.tier_threshold_da !== null : true);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [merchant.id]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  if (loading || !values) {
    return (
      <div className="border-border bg-surface-2 flex items-center gap-2 rounded-md border p-3 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Programme de {merchant.name}…
      </div>
    );
  }

  return (
    <form
      action={action}
      className="border-border bg-surface-2 space-y-3 rounded-md border p-3"
    >
      <input type="hidden" name="merchant_id" value={merchant.id} />
      <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />
      <input type="hidden" name="tier_on" value={tierOn ? "1" : "0"} />

      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <SlidersHorizontal className="text-primary-600 size-4" />
          Programme de {merchant.name}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-muted text-xs font-semibold">Actif</span>
          <Toggle
            checked={enabled}
            onChange={setEnabled}
            label="Programme actif"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="rp_rate">Cashback (%)</Label>
          <Input
            id="rp_rate"
            name="earn_rate_pct"
            inputMode="decimal"
            defaultValue={String(values.earn_rate_pct)}
            disabled={pending}
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp_cap">Plafond/24 h (DA)</Label>
          <Input
            id="rp_cap"
            name="daily_credit_cap_da"
            inputMode="numeric"
            defaultValue={String(values.daily_credit_cap_da)}
            disabled={pending}
            className="h-10"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rp_bonus">Bonus liaison (DA)</Label>
          <Input
            id="rp_bonus"
            name="link_bonus_da"
            inputMode="numeric"
            defaultValue={String(values.link_bonus_da)}
            disabled={pending}
            className="h-10"
          />
        </div>
        <div className="col-span-2 flex items-center gap-2 sm:col-span-3">
          <Toggle checked={tierOn} onChange={setTierOn} label="Palier bonus" />
          <span className="text-muted text-xs font-semibold">
            Palier « tous les X DA → bon de Y DA »
          </span>
        </div>
        {tierOn && (
          <>
            <div className="space-y-1">
              <Label htmlFor="rp_th">Seuil (DA)</Label>
              <Input
                id="rp_th"
                name="tier_threshold_da"
                inputMode="numeric"
                defaultValue={String(values.tier_threshold_da ?? 2000)}
                disabled={pending}
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp_rw">Bon (DA)</Label>
              <Input
                id="rp_rw"
                name="tier_reward_da"
                inputMode="numeric"
                defaultValue={String(values.tier_reward_da ?? 200)}
                disabled={pending}
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp_val">Validité (jours)</Label>
              <Input
                id="rp_val"
                name="voucher_validity_days"
                inputMode="numeric"
                defaultValue={String(values.voucher_validity_days)}
                disabled={pending}
                className="h-10"
              />
            </div>
          </>
        )}
        {!tierOn && (
          <input
            type="hidden"
            name="voucher_validity_days"
            value={String(values.voucher_validity_days)}
          />
        )}
      </div>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}

      <ActionButton
        type="submit"
        state={fb}
        idleIcon={<BadgeCheck className="size-4" />}
        labels={{
          idle: "Enregistrer le programme",
          success: "Programme enregistré ✓",
        }}
      />
    </form>
  );
}
