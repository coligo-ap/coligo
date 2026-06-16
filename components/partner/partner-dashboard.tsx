"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Banknote,
  Gift,
  Loader2,
  LogOut,
  Search,
  Send,
  ShieldCheck,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";
import {
  getMyWalletEntries,
  type MyWalletEntry,
} from "@/app/wallet/recharge-actions";
import {
  findBuyer,
  getPartnerStats,
  getPinStatus,
  partnerLogout,
  sellCredit,
  setPin as setPinAction,
  type PartnerStats,
} from "@/app/(partner)/actions";

const ENTRY_LABEL: Record<string, string> = {
  topup_chargily: "Recharge carte",
  topup_manual: "Recharge validée",
  topup_partner: "Recharge reçue",
  recharge_sale: "Vente de crédit",
  bonus: "Bonus reçu",
  fee_debit: "Frais",
  adjustment: "Ajustement",
};

export function PartnerDashboard({
  displayName,
  status,
  address,
  phone,
}: {
  displayName: string;
  status: "active" | "suspended" | "disabled";
  address: string | null;
  phone: string | null;
}) {
  const [stats, setStats] = useState<PartnerStats | null>(null);
  const [entries, setEntries] = useState<MyWalletEntry[]>([]);
  const [pin, setPinState] = useState<{ hasPin: boolean; locked: boolean }>({
    hasPin: false,
    locked: false,
  });

  const refresh = useCallback(async () => {
    const [s, e, p] = await Promise.all([
      getPartnerStats(),
      getMyWalletEntries(),
      getPinStatus(),
    ]);
    setStats(s);
    setEntries(e);
    setPinState(p);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      {/* En-tête */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="bg-primary-600 flex size-10 items-center justify-center rounded-2xl text-white">
            <Store className="size-5" />
          </span>
          <div>
            <h1 className="text-foreground text-base leading-tight font-bold">
              {displayName}
            </h1>
            <p className="text-muted text-xs">
              {address ?? "Point de recharge"}
            </p>
          </div>
        </div>
        <form action={partnerLogout}>
          <button
            type="submit"
            className="text-muted hover:text-foreground flex items-center gap-1 text-xs"
          >
            <LogOut className="size-4" /> Quitter
          </button>
        </form>
      </header>

      {status !== "active" && (
        <div className="text-danger-700 bg-danger-100 rounded-[12px] p-3 text-sm font-medium">
          Compte {status === "suspended" ? "suspendu" : "désactivé"} — contactez
          Coligo.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<Banknote className="size-4" />}
          label="Solde disponible"
          value={stats ? formatDA(stats.balanceDa) : "…"}
          highlight
        />
        <StatCard
          icon={<Gift className="size-4" />}
          label="Bonus reçus"
          value={stats ? formatDA(stats.totalBonusDa) : "…"}
        />
        <StatCard
          icon={<Send className="size-4" />}
          label="Total revendu"
          value={stats ? formatDA(stats.totalSoldDa) : "…"}
        />
        <StatCard
          icon={<ArrowUpRight className="size-4" />}
          label="Ventes"
          value={stats ? String(stats.salesCount) : "…"}
        />
      </div>

      {/* PIN requis pour vendre */}
      {!pin.hasPin && <PinSetup onDone={refresh} />}

      {/* Vendre du crédit */}
      <SellCredit
        canSell={pin.hasPin && status === "active"}
        onSold={refresh}
      />

      {/* Recharger mon solde (carte / virement-CCP) */}
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>

      {/* Historique */}
      <div className="border-border bg-surface rounded-[16px] border p-4 shadow-sm">
        <h2 className="text-foreground mb-2 text-sm font-bold">Historique</h2>
        {entries.length === 0 ? (
          <p className="text-muted text-sm">Aucune opération.</p>
        ) : (
          <ul className="divide-border divide-y">
            {entries.map((e, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="text-foreground text-xs">
                  {ENTRY_LABEL[e.type] ?? e.type}
                  <span className="text-subtle block">
                    {new Date(e.createdAt).toLocaleDateString("fr-DZ")}
                  </span>
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums ${e.amountDa < 0 ? "text-danger-700" : "text-success-700"}`}
                >
                  {e.amountDa > 0 ? "+" : ""}
                  {formatDA(e.amountDa)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {phone && (
        <p className="text-subtle text-center text-xs">Compte : {phone}</p>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-[16px] border p-3 ${highlight ? "border-primary-200 bg-primary-50" : "border-border bg-surface"}`}
    >
      <span
        className={`flex items-center gap-1 text-xs ${highlight ? "text-primary-700" : "text-muted"}`}
      >
        {icon} {label}
      </span>
      <p className="text-foreground mt-1 text-lg font-bold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function PinSetup({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border-warning-200 bg-warning-100 rounded-[16px] border p-4">
      <p className="text-warning-700 mb-2 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4" /> Définissez votre code PIN
      </p>
      <p className="text-warning-700 mb-2 text-xs">
        Un PIN à 4 chiffres est requis pour vendre du crédit en toute sécurité.
      </p>
      <div className="flex gap-2">
        <Input
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          inputMode="numeric"
          placeholder="••••"
          className="bg-surface"
        />
        <Button
          disabled={busy || pin.length !== 4}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const res = await setPinAction(pin);
            setBusy(false);
            if (res.ok) {
              setPin("");
              onDone();
            } else setErr(res.error ?? "Échec.");
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Valider
        </Button>
      </div>
      {err && <p className="text-danger-700 mt-2 text-xs">{err}</p>}
    </div>
  );
}

function SellCredit({
  canSell,
  onSold,
}: {
  canSell: boolean;
  onSold: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [buyer, setBuyer] = useState<{
    walletId: string;
    name: string | null;
    ownerType: string;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    setSearching(true);
    setErr(null);
    setMsg(null);
    setBuyer(null);
    const b = await findBuyer(phone);
    setSearching(false);
    if (!b) setErr("Aucun livreur/chauffeur avec ce numéro.");
    else
      setBuyer({ walletId: b.walletId, name: b.name, ownerType: b.ownerType });
  };

  const sell = async () => {
    if (!buyer) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await sellCredit({
      targetWalletId: buyer.walletId,
      amountDa: Number(amount),
      pin,
      opId: crypto.randomUUID(),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "Échec.");
      return;
    }
    setMsg(`Crédit envoyé à ${buyer.name ?? "l'opérateur"} ✓`);
    setAmount("");
    setPin("");
    setBuyer(null);
    setPhone("");
    onSold();
  };

  return (
    <div className="border-border bg-surface rounded-[16px] border p-4 shadow-sm">
      <h2 className="text-foreground mb-3 flex items-center gap-2 text-sm font-bold">
        <Send className="size-4" /> Vendre du crédit
      </h2>
      {!canSell && (
        <p className="text-muted mb-2 text-xs">
          Définissez votre PIN et assurez-vous que votre compte est actif pour
          vendre.
        </p>
      )}
      <div className="flex gap-2">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Téléphone du bénéficiaire"
          inputMode="tel"
          disabled={!canSell}
        />
        <Button
          variant="outline"
          disabled={!canSell || searching || !phone.trim()}
          onClick={() => void search()}
        >
          {searching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
        </Button>
      </div>

      {buyer && (
        <div className="mt-3 space-y-2">
          <div className="bg-surface-2 rounded-[12px] p-3 text-sm">
            <span className="text-foreground font-semibold">
              {buyer.name ?? "Opérateur"}
            </span>
            <Badge tone="neutral" className="ml-2">
              {buyer.ownerType === "driver" ? "Livreur" : "Chauffeur"}
            </Badge>
          </div>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder="Montant à envoyer (DA)"
          />
          <Input
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            inputMode="numeric"
            type="password"
            placeholder="Votre PIN"
          />
          <Button
            className="w-full"
            disabled={busy || !amount || pin.length !== 4}
            onClick={() => void sell()}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Envoyer le crédit
          </Button>
        </div>
      )}

      {msg && (
        <p className="text-success-700 mt-2 text-sm font-medium">{msg}</p>
      )}
      {err && <p className="text-danger-700 mt-2 text-sm font-medium">{err}</p>}
    </div>
  );
}
