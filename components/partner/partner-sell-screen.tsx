"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Search, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import {
  findBuyer,
  getPinStatus,
  sellCredit,
  setPin as setPinAction,
} from "@/app/(partner)/actions";

// =============================================================================
// SOUS-PAGE « VENDRE DU CRÉDIT » — le geste métier de l'agent.
//
// Avant, cet écran était noyé au milieu de l'accueil agent (solde, aide,
// recharge, historique, dossier empilés sur une seule page interminable).
// Il a désormais SA page : l'agent l'ouvre, fait sa vente, revient.
//
// Le PIN est demandé ICI quand il manque : c'est la condition de la vente,
// pas une corvée d'accueil.
// =============================================================================

export function PartnerSellScreen() {
  const [pin, setPinState] = useState<{ hasPin: boolean; locked: boolean }>({
    hasPin: false,
    locked: false,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setPinState(await getPinStatus());
    setLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return null;

  return (
    <div className="space-y-4">
      {!pin.hasPin && <PinSetup onDone={refresh} />}
      <SellCredit canSell={pin.hasPin} onSold={refresh} />
    </div>
  );
}

function PinSetup({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border-warning-200 bg-warning-100 rounded-lg border p-4">
      <p className="text-warning-700 mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4" /> Définissez votre code PIN
      </p>
      <p className="text-warning-700 mb-2 text-xs">
        Un PIN à 4 chiffres protège chaque vente de crédit. Indispensable avant
        de vendre.
      </p>
      <div className="flex gap-2">
        <PasswordInput
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          inputMode="numeric"
          placeholder="••••"
          containerClassName="w-[170px] shrink-0"
          className="bg-surface text-center text-lg tracking-[0.4em]"
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
    <div className="border-border bg-surface rounded-lg border p-4 shadow-sm">
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
        <p className="text-warning-700 bg-warning-100 rounded-md p-2.5 text-xs">
          Définissez d&apos;abord votre PIN (ci-dessus) et assurez-vous que
          votre compte est actif.
        </p>
      ) : (
        <>
          {/* Étape 1 — trouver le bénéficiaire */}
          <p className="text-subtle text-caption mb-1 font-semibold uppercase">
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
              <div className="bg-success-100 flex items-center gap-2 rounded-md p-3">
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
                <p className="text-subtle text-caption mb-1 font-semibold uppercase">
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
                <p className="text-subtle text-caption mb-1 font-semibold uppercase">
                  3 · Confirmez avec votre PIN
                </p>
                <PasswordInput
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  inputMode="numeric"
                  placeholder="••••"
                  containerClassName="max-w-[170px]"
                  className="text-center text-lg tracking-[0.4em]"
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
