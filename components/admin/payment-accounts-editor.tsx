"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useActionButton } from "@/lib/hooks/use-action-button";
import {
  updatePaymentAccount,
  type PaymentAccount,
  type PaymentScope,
} from "@/app/admin/recharges/actions";

const SCOPE_LABEL: Record<PaymentScope, string> = {
  driver: "Livreurs",
  chauffeur: "Chauffeurs",
  merchant: "Commerçants",
  partner: "Agents Coligo Pay",
};

/**
 * Éditeur des comptes de versement de la plateforme (CCP + banque) PAR MODULE.
 * Affiche une carte par module fourni : passez les 4 comptes (vue centrale
 * /admin/recharges) ou un seul (dans la page d'un module). Chaque opérateur
 * verra, dans sa page de recharge, le compte de SON module.
 */
export function PaymentAccountsEditor({
  accounts,
}: {
  accounts: PaymentAccount[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {accounts.map((a) => (
        <AccountCard key={a.scope} initial={a} />
      ))}
    </div>
  );
}

function AccountCard({ initial }: { initial: PaymentAccount }) {
  const router = useRouter();
  const { state, run } = useActionButton();
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const field = (k: keyof PaymentAccount) => ({
    value: v[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setV({ ...v, [k]: e.target.value }),
  });

  const save = () => {
    setErr(null);
    void run(
      async () => {
        const res = await updatePaymentAccount(v);
        if (res.error) setErr(res.error);
        else router.refresh();
        return res;
      },
      (res) => !res.error
    );
  };

  return (
    <div className="border-border bg-surface rounded-[14px] border p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="bg-primary-50 text-primary-600 flex size-8 items-center justify-center rounded-full">
          <Building2 className="size-4" />
        </span>
        <h3 className="text-foreground text-sm font-bold">
          {SCOPE_LABEL[v.scope]}
        </h3>
      </div>

      {/* CCP */}
      <p className="text-muted mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <Landmark className="size-3.5" /> CCP
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Numéro CCP</Label>
          <Input {...field("ccpNumber")} placeholder="002 345 678" />
        </div>
        <div className="space-y-1">
          <Label>Clé</Label>
          <Input {...field("ccpKey")} placeholder="45" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Titulaire</Label>
          <Input {...field("ccpHolder")} placeholder="Coligo SPA" />
        </div>
      </div>

      {/* Banque */}
      <p className="text-muted mt-4 mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <Building2 className="size-3.5" /> Compte bancaire (optionnel)
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Banque</Label>
          <Input {...field("bankName")} placeholder="BNA, CPA…" />
        </div>
        <div className="space-y-1">
          <Label>RIB</Label>
          <Input {...field("bankRib")} placeholder="20 chiffres" />
        </div>
      </div>

      {err && <p className="text-danger-600 mt-2 text-sm">{err}</p>}

      <ActionButton
        size="sm"
        className="mt-3"
        state={state}
        onClick={save}
        idleIcon={<CheckCircle2 className="size-4" />}
        labels={{ idle: "Enregistrer", success: "Enregistré ✓" }}
      />
    </div>
  );
}
