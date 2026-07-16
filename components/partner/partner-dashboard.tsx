"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  Gift,
  HandCoins,
  Info,
  Loader2,
  LogOut,
  Search,
  Send,
  ShieldCheck,
  Store,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import { BadgeCheck } from "lucide-react";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";
import { DossierSection } from "@/components/partner/dossier-section";
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
  walletId,
  displayName,
  status,
  isVerified,
  rejectedReason,
  address,
  phone,
}: {
  walletId: string;
  displayName: string;
  status: "active" | "suspended" | "disabled" | "pending" | "rejected";
  isVerified: boolean;
  rejectedReason: string | null;
  address: string | null;
  phone: string | null;
}) {
  const isActive = status === "active";
  const [stats, setStats] = useState<PartnerStats | null>(null);
  const [entries, setEntries] = useState<MyWalletEntry[]>([]);
  const [pin, setPinState] = useState<{ hasPin: boolean; locked: boolean }>({
    hasPin: false,
    locked: false,
  });
  const [showHelp, setShowHelp] = useState(false);

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
    <div className="mx-auto max-w-2xl space-y-4 p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      {/* ===== HERO ===== */}
      <div className="border-border relative overflow-hidden rounded-[20px] border bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="bg-primary-50 text-primary-700 flex size-10 items-center justify-center rounded-2xl">
              <Store className="size-5" />
            </span>
            <div>
              <p className="text-foreground flex items-center gap-1.5 text-[15px] leading-tight font-bold">
                {displayName}
                {isVerified && (
                  <BadgeCheck
                    className="text-success-600 size-4"
                    aria-label="Vérifié"
                  />
                )}
              </p>
              <p className="text-muted text-xs">
                {address ?? "Agent Coligo Pay"}
              </p>
            </div>
          </div>
          <form action={partnerLogout}>
            <button
              type="submit"
              className="border-border text-muted hover:bg-surface-2 flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
            >
              <LogOut className="size-3.5" /> Quitter
            </button>
          </form>
        </div>

        <p className="text-muted mt-4 text-xs">Solde disponible</p>
        <p className="text-foreground text-3xl font-extrabold tabular-nums">
          {stats ? formatDA(stats.balanceDa) : "…"}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <HeroChip
            icon={<Gift className="size-3.5" />}
            label="Bonus reçus"
            value={stats ? formatDA(stats.totalBonusDa) : "…"}
          />
          <HeroChip
            icon={<Send className="size-3.5" />}
            label="Revendu"
            value={stats ? formatDA(stats.totalSoldDa) : "…"}
          />
          <HeroChip
            icon={<HandCoins className="size-3.5" />}
            label="Ventes"
            value={stats ? String(stats.salesCount) : "…"}
          />
        </div>

        {status === "pending" && (
          <div className="border-warning-200 bg-warning-50 text-warning-800 mt-3 flex items-start gap-2 rounded-[12px] border p-2.5 text-xs font-semibold">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Demande en cours d&apos;examen. Complétez votre dossier ci-dessous
              — Coligo l&apos;active dès validation.
            </span>
          </div>
        )}
        {status === "rejected" && (
          <div className="border-danger-200 bg-danger-50 text-danger-700 mt-3 flex items-start gap-2 rounded-[12px] border p-2.5 text-xs font-semibold">
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Dossier refusé{rejectedReason ? ` : ${rejectedReason}` : ""}.
              Corrigez vos pièces ci-dessous puis renvoyez.
            </span>
          </div>
        )}
        {(status === "suspended" || status === "disabled") && (
          <div className="border-warning-200 bg-warning-50 text-warning-800 mt-3 flex items-start gap-2 rounded-[12px] border p-2.5 text-xs font-semibold">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Compte {status === "suspended" ? "suspendu" : "désactivé"} —
              contactez Coligo pour le réactiver.
            </span>
          </div>
        )}
      </div>

      {/* Dossier (pièces) — prioritaire tant que le compte n'est pas actif. */}
      {!isActive && <DossierSection walletId={walletId} />}

      {/* ===== COMMENT ÇA MARCHE ===== */}
      <div className="border-border bg-surface rounded-[16px] border">
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="flex w-full items-center gap-2 p-4 text-left"
        >
          <Info className="text-primary-600 size-4 shrink-0" />
          <span className="text-foreground flex-1 text-sm font-semibold">
            Comment ça marche ?
          </span>
          <span className="text-muted text-xs">
            {showHelp ? "Masquer" : "Voir"}
          </span>
        </button>
        {showHelp && (
          <div className="space-y-3 px-4 pb-4">
            <Step
              n={1}
              icon={<ArrowDownToLine className="size-4" />}
              title="Rechargez votre crédit"
              desc="Approvisionnez votre solde par carte (Chargily) ou par virement/CCP avec preuve."
            />
            <Step
              n={2}
              icon={<Send className="size-4" />}
              title="Revendez aux livreurs & chauffeurs"
              desc="Ils vous paient en espèces, vous leur envoyez le crédit depuis votre solde (avec votre PIN)."
            />
            <Step
              n={3}
              icon={<Gift className="size-4" />}
              title="Coligo vous récompense"
              desc="Vous recevez des bonus selon votre volume. Tout est tracé dans l'historique."
            />
          </div>
        )}
      </div>

      {isActive && (
        <>
          {/* PIN requis */}
          {!pin.hasPin && <PinSetup onDone={refresh} />}

          {/* ===== VENDRE ===== */}
          <SellCredit canSell={pin.hasPin} onSold={refresh} />

          {/* ===== RECHARGER (sans double carte de solde) ===== */}
          <Suspense fallback={null}>
            <OperatorRecharge
              compact
              title="Recharger mon crédit (carte ou virement)"
            />
          </Suspense>

          {/* ===== HISTORIQUE ===== */}
          <div className="border-border bg-surface rounded-[16px] border p-4 shadow-sm">
            <h2 className="text-foreground mb-2 text-sm font-bold">
              Historique
            </h2>
            {entries.length === 0 ? (
              <p className="text-muted text-sm">
                Aucune opération pour le moment.
              </p>
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

          {/* Mon dossier — gestion / remplacement des pièces (agent actif). */}
          <DossierSection walletId={walletId} />
        </>
      )}

      {phone && (
        <p className="text-subtle text-center text-xs">
          Connecté · {phone.replace(/(\d{4})(\d+)(\d{2})/, "$1•••$3")}
        </p>
      )}
    </div>
  );
}

function HeroChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border bg-surface-2 rounded-[12px] border p-2">
      <span className="text-muted flex items-center gap-1 text-[10px]">
        {icon} {label}
      </span>
      <p className="text-foreground mt-0.5 text-sm font-bold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  desc,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="bg-primary-50 text-primary-600 relative flex size-9 shrink-0 items-center justify-center rounded-full">
        {icon}
        <span className="bg-primary-600 absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white">
          {n}
        </span>
      </span>
      <div>
        <p className="text-foreground text-sm font-semibold">{title}</p>
        <p className="text-muted text-xs">{desc}</p>
      </div>
    </div>
  );
}

function PinSetup({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border-warning-200 bg-warning-100 rounded-[16px] border p-4">
      <p className="text-warning-700 mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4" /> Définissez votre code PIN
      </p>
      <p className="text-warning-700 mb-2 text-xs">
        Un PIN à 4 chiffres protège chaque vente de crédit. Indispensable avant
        de vendre.
      </p>
      <div className="flex gap-2">
        <Input
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          inputMode="numeric"
          type="password"
          placeholder="••••"
          className="bg-surface max-w-[140px] text-center text-lg tracking-[0.4em]"
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
          Enregistrer
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

  const reset = () => {
    setBuyer(null);
    setPhone("");
    setAmount("");
    setPin("");
  };

  const search = async () => {
    setSearching(true);
    setErr(null);
    setMsg(null);
    setBuyer(null);
    const b = await findBuyer(phone);
    setSearching(false);
    if (!b) setErr("Aucun livreur / chauffeur trouvé avec ce numéro.");
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
    setMsg(
      `${formatDA(Number(amount))} envoyés à ${buyer.name ?? "l'opérateur"} ✓`
    );
    reset();
    onSold();
  };

  return (
    <div className="border-border bg-surface rounded-[16px] border p-4 shadow-sm">
      <h2 className="text-foreground flex items-center gap-2 text-sm font-bold">
        <span className="bg-primary-600 flex size-7 items-center justify-center rounded-full text-white">
          <Send className="size-4" />
        </span>
        Vendre du crédit
      </h2>
      <p className="text-muted mt-1 mb-3 text-xs">
        Le client vous paie en espèces, vous lui envoyez le crédit sur son
        compte Coligo.
      </p>

      {!canSell ? (
        <p className="text-warning-700 bg-warning-100 rounded-[12px] p-2.5 text-xs">
          Définissez d&apos;abord votre PIN (ci-dessus) et assurez-vous que
          votre compte est actif.
        </p>
      ) : (
        <>
          {/* Étape 1 — trouver le bénéficiaire */}
          <p className="text-subtle mb-1 text-[11px] font-semibold uppercase">
            1 · Bénéficiaire
          </p>
          <div className="flex gap-2">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Téléphone du livreur / chauffeur"
              inputMode="tel"
              disabled={!!buyer}
            />
            {buyer ? (
              <Button variant="outline" onClick={reset}>
                Changer
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={searching || !phone.trim()}
                onClick={() => void search()}
              >
                {searching ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
              </Button>
            )}
          </div>

          {buyer && (
            <div className="mt-3 space-y-3">
              <div className="bg-success-100 flex items-center gap-2 rounded-[12px] p-3">
                <CheckCircle2 className="text-success-700 size-4 shrink-0" />
                <span className="text-foreground text-sm font-semibold">
                  {buyer.name ?? "Opérateur"}
                </span>
                <Badge tone="neutral">
                  {buyer.ownerType === "driver" ? "Livreur" : "Chauffeur"}
                </Badge>
              </div>

              {/* Étape 2 — montant */}
              <div>
                <p className="text-subtle mb-1 text-[11px] font-semibold uppercase">
                  2 · Montant payé en espèces
                </p>
                <div className="flex flex-wrap gap-2">
                  {[500, 1000, 2000, 5000].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmount(String(v))}
                      className={
                        Number(amount) === v
                          ? "border-primary-600 text-primary-700 bg-primary-50 rounded-full border px-3 py-1 text-sm font-semibold"
                          : "border-border text-foreground rounded-full border px-3 py-1 text-sm"
                      }
                    >
                      {formatDA(v)}
                    </button>
                  ))}
                </div>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="numeric"
                  placeholder="Autre montant (DA)"
                  className="mt-2"
                />
              </div>

              {/* Étape 3 — PIN + envoyer */}
              <div>
                <p className="text-subtle mb-1 text-[11px] font-semibold uppercase">
                  3 · Confirmez avec votre PIN
                </p>
                <Input
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  inputMode="numeric"
                  type="password"
                  placeholder="••••"
                  className="max-w-[140px] text-center text-lg tracking-[0.4em]"
                />
              </div>

              <Button
                className="w-full"
                disabled={busy || !amount || pin.length !== 4}
                onClick={() => void sell()}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                Envoyer {amount ? formatDA(Number(amount)) : "le crédit"}
              </Button>
            </div>
          )}
        </>
      )}

      {msg && (
        <p className="text-success-700 mt-2 text-sm font-semibold">{msg}</p>
      )}
      {err && <p className="text-danger-700 mt-2 text-sm font-medium">{err}</p>}
    </div>
  );
}
