"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Search, Trash2, Users, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import {
  issueVoucher,
  revokeVoucher,
  searchCustomers,
  type CustomerHit,
  type VoucherInput,
} from "@/app/admin/marketing/actions";

// =============================================================================
// VouchersManager — émettre un bon (1 client, plusieurs, ou TOUS) + liste/révoke.
// =============================================================================

export type AdminVoucher = {
  id: string;
  amount_da: number;
  label_fr: string | null;
  reason: "gift" | "loyalty" | "compensation" | "campaign";
  status: "granted" | "revoked";
  batch_id: string | null;
  created_at: string;
  customers: { full_name: string | null; phone: string | null } | null;
};

const REASON_LABEL: Record<AdminVoucher["reason"], string> = {
  gift: "Cadeau",
  loyalty: "Fidélité",
  compensation: "Dédommagement",
  campaign: "Campagne",
};

export function VouchersManager({ vouchers }: { vouchers: AdminVoucher[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function revoke(v: AdminVoucher) {
    startTransition(async () => {
      const ok = await confirm({
        title: "Révoquer ce bon ?",
        message: `Le crédit de ${formatDA(v.amount_da)} sera repris (seulement s'il n'a pas été dépensé).`,
        confirmLabel: "Révoquer",
        danger: true,
      });
      if (!ok) return;
      const res = await revokeVoucher(v.id);
      if (res.error) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-[12px] px-4 py-2.5 text-sm font-bold text-white"
      >
        <Gift className="size-4" /> Émettre un bon
      </button>

      {vouchers.length === 0 ? (
        <p className="text-muted border-border rounded-[16px] border border-dashed px-6 py-10 text-center text-sm">
          Aucun bon émis pour le moment.
        </p>
      ) : (
        <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-[16px] border">
          {vouchers.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-4 py-3">
              <span className="bg-success-50 text-success-700 grid size-9 shrink-0 place-items-center rounded-[10px]">
                <Gift className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-bold">
                  {v.customers?.full_name || "Client"}
                  {v.customers?.phone && (
                    <span className="text-muted font-normal">
                      {" · "}
                      {v.customers.phone}
                    </span>
                  )}
                </p>
                <p className="text-muted text-xs">
                  {REASON_LABEL[v.reason]}
                  {v.label_fr ? ` · ${v.label_fr}` : ""}
                  {" · "}
                  {new Date(v.created_at).toLocaleDateString("fr-DZ", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <span className="text-success-700 shrink-0 text-sm font-black tabular-nums">
                + {formatDA(v.amount_da)}
              </span>
              {v.status === "revoked" ? (
                <span className="text-muted bg-surface-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold">
                  Révoqué
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => revoke(v)}
                  disabled={pending}
                  title="Révoquer"
                  className="text-danger-600 hover:bg-danger-50 grid size-8 shrink-0 place-items-center rounded-full"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <IssueForm
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulaire d'émission.
// ---------------------------------------------------------------------------
function IssueForm({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("500");
  const [labelFr, setLabelFr] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [reason, setReason] = useState<VoucherInput["reason"]>("gift");
  const [toAll, setToAll] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [selected, setSelected] = useState<CustomerHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [searching, startSearch] = useTransition();

  function runSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    startSearch(async () => {
      const res = await searchCustomers(q);
      setHits(res);
    });
  }

  function addSelected(h: CustomerHit) {
    if (!selected.some((s) => s.id === h.id)) setSelected((s) => [...s, h]);
    setQuery("");
    setHits([]);
  }

  function submit() {
    setError(null);
    setInfo(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Montant invalide.");
      return;
    }
    if (!toAll && selected.length === 0) {
      setError("Choisis au moins un client, ou coche « Tous les clients ».");
      return;
    }
    startTransition(async () => {
      const res = await issueVoucher({
        amount_da: amt,
        label_fr: labelFr,
        label_ar: labelAr,
        reason,
        customer_ids: toAll ? null : selected.map((s) => s.id),
      });
      if (res.error) setError(res.error);
      else {
        setInfo(`${res.count ?? 0} bon(s) émis.`);
        setTimeout(onDone, 700);
      }
    });
  }

  const input =
    "border-border bg-surface focus:border-primary-500 w-full rounded-[10px] border px-3 py-2 text-sm outline-none";
  const label = "text-muted mb-1 block text-xs font-semibold";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] shadow-xl sm:rounded-[20px]">
        <header className="border-border flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-foreground text-lg font-bold">Émettre un bon</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-surface-2 rounded-full p-1.5"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Montant (DA)</label>
              <input
                type="number"
                className={input}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={1}
              />
            </div>
            <div>
              <label className={label}>Motif</label>
              <select
                className={input}
                value={reason}
                onChange={(e) =>
                  setReason(e.target.value as VoucherInput["reason"])
                }
              >
                <option value="gift">Cadeau</option>
                <option value="loyalty">Fidélité</option>
                <option value="compensation">Dédommagement</option>
                <option value="campaign">Campagne</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Libellé (FR)</label>
              <input
                className={input}
                value={labelFr}
                onChange={(e) => setLabelFr(e.target.value)}
                placeholder="Bon de bienvenue"
                maxLength={80}
              />
            </div>
            <div>
              <label className={label}>Libellé (AR)</label>
              <input
                className={input}
                value={labelAr}
                onChange={(e) => setLabelAr(e.target.value)}
                dir="rtl"
                maxLength={80}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setToAll((v) => !v)}
            className={cn(
              "flex w-full items-center gap-2 rounded-[12px] border px-3 py-2.5 text-sm font-semibold",
              toAll
                ? "border-primary-500 bg-primary-50 text-primary-700"
                : "border-border text-muted"
            )}
          >
            <Users className="size-4" />
            Tous les clients (diffusion)
          </button>

          {!toAll && (
            <div>
              <label className={label}>Clients ciblés</label>
              {selected.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {selected.map((s) => (
                    <span
                      key={s.id}
                      className="bg-primary-50 text-primary-700 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold"
                    >
                      {s.full_name || s.phone || "Client"}
                      <button
                        type="button"
                        onClick={() =>
                          setSelected((arr) => arr.filter((x) => x.id !== s.id))
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <Search className="text-subtle absolute start-3 top-1/2 size-4 -translate-y-1/2" />
                <input
                  className={cn(input, "ps-9")}
                  value={query}
                  onChange={(e) => runSearch(e.target.value)}
                  placeholder="Rechercher par téléphone ou nom"
                />
              </div>
              {searching && (
                <p className="text-muted mt-1 text-xs">Recherche…</p>
              )}
              {hits.length > 0 && (
                <ul className="border-border mt-1 max-h-44 overflow-y-auto rounded-[10px] border">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => addSelected(h)}
                        className="hover:bg-surface-2 flex w-full items-center justify-between px-3 py-2 text-start text-sm"
                      >
                        <span className="text-foreground font-medium">
                          {h.full_name || "Client"}
                        </span>
                        <span className="text-muted text-xs">{h.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p className="text-danger-700 text-sm font-medium">{error}</p>
          )}
          {info && (
            <p className="text-success-700 text-sm font-medium">{info}</p>
          )}
        </div>

        <footer className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-surface-2 rounded-[10px] px-4 py-2 text-sm font-semibold"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="bg-primary-600 hover:bg-primary-700 rounded-[10px] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? "…" : "Émettre"}
          </button>
        </footer>
      </div>
    </div>
  );
}
