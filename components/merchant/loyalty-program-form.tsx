"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Sparkles, Ticket, Users, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { formatDA } from "@/lib/utils";
import {
  updateLoyaltyProgram,
  type LoyaltyFormResult,
} from "@/app/(merchant)/fidelite/actions";

export type LoyaltyState = {
  program: {
    enabled: boolean;
    earn_rate_pct: number | string;
    tier_threshold_da: number | null;
    tier_reward_da: number | null;
    voucher_validity_days: number;
    daily_credit_cap_da: number;
    link_bonus_da: number;
  } | null;
  bounds: {
    min_earn_rate_pct: number | string;
    max_earn_rate_pct: number | string;
    min_tier_threshold_da: number;
    max_tier_reward_da: number;
    max_daily_credit_cap_da: number;
    max_link_bonus_da: number;
    min_voucher_validity_days: number;
    max_voucher_validity_days: number;
  };
  stats: {
    members: number;
    outstanding_da: number;
    earned_30d_da: number;
    redeemed_30d_da: number;
  };
};

const initial: LoyaltyFormResult = {};

/**
 * Réglages du programme de fidélité du commerçant, avec SIMULATION EN DIRECT :
 * « un client qui dépense X DA gagnera : … ». Les bornes plateforme sont
 * affichées sous chaque champ ; une valeur hors bornes est refusée côté
 * serveur (RPC + trigger DB), jamais seulement par l'UI.
 */
export function LoyaltyProgramForm({ state }: { state: LoyaltyState }) {
  const router = useRouter();
  const { program, bounds, stats } = state;
  const [formState, action, pending] = useActionState(
    updateLoyaltyProgram,
    initial
  );
  const fb = useFormActionFeedback({
    pending,
    ok: formState.ok,
    error: formState.error,
  });

  const [enabled, setEnabled] = useState(program?.enabled ?? false);
  const [rate, setRate] = useState(String(program?.earn_rate_pct ?? 5));
  // Mode POINTS = taux 0 % (accepté par le cœur : progression seule) — le
  // client cumule uniquement vers les PALIERS (« tous les X DA → un bon »).
  const [mode, setMode] = useState<"cash" | "points">(
    program && Number(program.earn_rate_pct) === 0 ? "points" : "cash"
  );
  const [tierOn, setTierOn] = useState(
    program ? program.tier_threshold_da !== null : true
  );
  const [threshold, setThreshold] = useState(
    String(program?.tier_threshold_da ?? 2000)
  );
  const [reward, setReward] = useState(String(program?.tier_reward_da ?? 200));
  const [validity, setValidity] = useState(
    String(program?.voucher_validity_days ?? 90)
  );
  const [dailyCap, setDailyCap] = useState(
    String(program?.daily_credit_cap_da ?? 1000)
  );
  const [linkBonus, setLinkBonus] = useState(
    String(program?.link_bonus_da ?? 0)
  );
  const [sim, setSim] = useState("5000");

  useEffect(() => {
    if (formState.ok) router.refresh();
  }, [formState, router]);

  const isPoints = mode === "points";
  // En mode points : palier OBLIGATOIRE (c'est le seul gain) et taux forcé à 0.
  const effTierOn = isPoints || tierOn;

  const preview = useMemo(() => {
    const amount = Math.max(0, Math.round(Number(sim) || 0));
    const r = isPoints ? 0 : Number(rate.replace(",", ".")) || 0;
    const th = effTierOn ? Math.round(Number(threshold) || 0) : 0;
    const rw = effTierOn ? Math.round(Number(reward) || 0) : 0;
    const cash = Math.round((amount * r) / 100);
    const vouchers = th > 0 ? Math.floor(amount / th) : 0;
    const towardNext = th > 0 ? th - (amount % th) : 0;
    return { amount, cash, vouchers, reward: rw, towardNext, hasTier: th > 0 };
  }, [sim, rate, isPoints, effTierOn, threshold, reward]);

  const hasActivity =
    stats.members > 0 || stats.earned_30d_da > 0 || stats.redeemed_30d_da > 0;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />
      <input type="hidden" name="tier_on" value={effTierOn ? "1" : "0"} />
      {isPoints && <input type="hidden" name="earn_rate_pct" value="0" />}

      {hasActivity && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            icon={<Users className="size-4" />}
            label="Clients fidèles"
            value={String(stats.members)}
          />
          <StatTile
            icon={<Wallet className="size-4" />}
            label="Encours"
            value={formatDA(stats.outstanding_da)}
          />
          <StatTile
            icon={<Gift className="size-4" />}
            label="Offert (30 j)"
            value={formatDA(stats.earned_30d_da)}
          />
          <StatTile
            icon={<Ticket className="size-4" />}
            label="Utilisé (30 j)"
            value={formatDA(stats.redeemed_30d_da)}
          />
        </div>
      )}

      <div className="border-border bg-surface flex items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <p className="text-sm font-semibold">Programme actif</p>
          <p className="text-muted text-xs">
            Vos clients cumulent à chaque passage en caisse.
          </p>
        </div>
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Programme actif"
        />
      </div>

      {/* Mode : cashback en % OU points (paliers seuls, taux 0). */}
      <div className="border-border bg-surface space-y-3 rounded-md border p-3">
        <p className="text-sm font-semibold">Mode de récompense</p>
        <Segmented<"cash" | "points">
          ariaLabel="Mode de récompense"
          value={mode}
          onChange={(m) => {
            setMode(m);
            if (m === "points") {
              setTierOn(true);
            } else if (Number(rate.replace(",", ".")) === 0) {
              setRate("5");
            }
          }}
          options={[
            { key: "cash", label: "Cashback %" },
            { key: "points", label: "Points (paliers)" },
          ]}
        />
        <p className="text-muted text-xs">
          {isPoints
            ? "Aucun % crédité : le client PROGRESSE à chaque achat vers un bon (« tous les X DA → un bon de Y DA »)."
            : "Un % de chaque achat est crédité en cagnotte, dépensable chez vous."}
        </p>
        {!isPoints && (
          <div className="space-y-1.5">
            <Label htmlFor="earn_rate_pct">Taux sur chaque achat (%)</Label>
            <Input
              id="earn_rate_pct"
              name="earn_rate_pct"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              disabled={pending}
            />
            <p className="text-subtle text-xs">
              Autorisé : {String(bounds.min_earn_rate_pct)} % à{" "}
              {String(bounds.max_earn_rate_pct)} %.
            </p>
          </div>
        )}
      </div>

      {/* Palier */}
      <div className="border-border bg-surface space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Palier bonus</p>
            <p className="text-muted text-xs">
              « Tous les X DA dépensés → un bon d&apos;achat de Y DA. »
            </p>
          </div>
          {isPoints ? (
            <span className="bg-primary-50 text-primary-700 rounded-full px-2.5 py-1 text-xs font-bold">
              obligatoire en mode points
            </span>
          ) : (
            <Toggle
              checked={tierOn}
              onChange={setTierOn}
              label="Palier bonus"
            />
          )}
        </div>
        {effTierOn && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tier_threshold_da">Seuil (DA)</Label>
              <Input
                id="tier_threshold_da"
                name="tier_threshold_da"
                inputMode="numeric"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                disabled={pending}
              />
              <p className="text-subtle text-xs">
                Min. {formatDA(bounds.min_tier_threshold_da)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier_reward_da">Bon offert (DA)</Label>
              <Input
                id="tier_reward_da"
                name="tier_reward_da"
                inputMode="numeric"
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                disabled={pending}
              />
              <p className="text-subtle text-xs">
                Max. {formatDA(bounds.max_tier_reward_da)}
              </p>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="voucher_validity_days">
                Validité des bons (jours)
              </Label>
              <Input
                id="voucher_validity_days"
                name="voucher_validity_days"
                inputMode="numeric"
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
                disabled={pending}
              />
              <p className="text-subtle text-xs">
                Entre {bounds.min_voucher_validity_days} et{" "}
                {bounds.max_voucher_validity_days} jours.
              </p>
            </div>
          </div>
        )}
        {!effTierOn && (
          <input type="hidden" name="voucher_validity_days" value={validity} />
        )}
      </div>

      {/* SIMULATION EN DIRECT */}
      <div className="border-primary-200 bg-primary-50 space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="text-primary-700 size-4" />
          <p className="text-primary-900 text-sm font-semibold">Simulation</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-primary-900 text-sm">Un client dépense</span>
          <Input
            aria-label="Montant simulé"
            inputMode="numeric"
            value={sim}
            onChange={(e) => setSim(e.target.value)}
            className="h-9 w-24 bg-white text-center"
          />
          <span className="text-primary-900 text-sm">DA</span>
        </div>
        <p className="text-primary-900 text-sm">
          {isPoints ? (
            preview.hasTier && preview.vouchers > 0 ? (
              <>
                Il gagnera{" "}
                <strong>
                  {preview.vouchers} bon{preview.vouchers > 1 ? "s" : ""} de{" "}
                  {formatDA(preview.reward)}
                </strong>
                .
              </>
            ) : (
              <>Il progresse vers son prochain bon (aucun % crédité).</>
            )
          ) : (
            <>
              Il gagnera <strong>{formatDA(preview.cash)} de cashback</strong>
              {preview.hasTier && preview.vouchers > 0 && (
                <>
                  {" "}
                  +{" "}
                  <strong>
                    {preview.vouchers} bon{preview.vouchers > 1 ? "s" : ""} de{" "}
                    {formatDA(preview.reward)}
                  </strong>
                </>
              )}
              .
            </>
          )}
        </p>
        {preview.hasTier && preview.towardNext > 0 && (
          <p className="text-primary-800 text-xs">
            Il lui restera {formatDA(preview.towardNext)} à dépenser pour
            débloquer le bon suivant — votre caissier peut le dire à voix haute.
          </p>
        )}
      </div>

      {/* Garde-fous */}
      <div className="border-border bg-surface space-y-3 rounded-md border p-3">
        <p className="text-sm font-semibold">Garde-fous</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="daily_credit_cap_da">
              Plafond par client / 24 h (DA)
            </Label>
            <Input
              id="daily_credit_cap_da"
              name="daily_credit_cap_da"
              inputMode="numeric"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              disabled={pending}
            />
            <p className="text-subtle text-xs">
              Max. {formatDA(bounds.max_daily_credit_cap_da)}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link_bonus_da">Bonus de liaison (DA)</Label>
            <Input
              id="link_bonus_da"
              name="link_bonus_da"
              inputMode="numeric"
              value={linkBonus}
              onChange={(e) => setLinkBonus(e.target.value)}
              disabled={pending}
            />
            <p className="text-subtle text-xs">
              Offert quand un client lie votre carte à son compte. Max.{" "}
              {formatDA(bounds.max_link_bonus_da)}
            </p>
          </div>
        </div>
      </div>

      {formState.error && (
        <p className="text-danger-600 text-sm">{formState.error}</p>
      )}

      <ActionButton
        type="submit"
        state={fb}
        idleIcon={<Gift className="size-4" />}
        labels={{ idle: "Enregistrer le programme", success: "Enregistré ✓" }}
      />
    </form>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border bg-surface rounded-control border p-3">
      <div className="text-muted flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}
