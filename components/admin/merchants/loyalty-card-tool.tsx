"use client";

import { useState } from "react";
import { ArrowRightLeft, Ban, Loader2, Search, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatDA } from "@/lib/utils";
import { groupCardCode } from "@/lib/loyalty/card-templates";
import {
  adminBlockLoyaltyCard,
  adminLookupLoyaltyCard,
  adminTransferLoyaltyCard,
  adminUnblockLoyaltyCard,
  type AdminCardLookup,
} from "@/app/admin/merchants/fidelite/actions";

const STATUS_FR: Record<string, { label: string; cls: string }> = {
  printed: { label: "Imprimée (à distribuer)", cls: "bg-surface-3 text-muted" },
  activated: { label: "Activée", cls: "bg-primary-50 text-primary-700" },
  linked: { label: "Liée à un compte", cls: "bg-success-50 text-success-700" },
  blocked: { label: "Bloquée", cls: "bg-danger-50 text-danger-600" },
};

const REASON_FR: Record<string, string> = {
  bad_query: "Saisissez le numéro complet (16 caractères) ou l'URL du QR.",
  not_found: "Carte introuvable.",
  forbidden: "Accès réservé au domaine Commerçants.",
  not_blocked: "Bloquez d'abord la carte avant de transférer son solde.",
  card_linked:
    "Carte liée à un compte : son solde vit déjà sur le compte client, rien à transférer.",
  target_not_found: "Destination introuvable (carte ou QR client).",
  target_blocked: "La destination est bloquée.",
  target_linked: "La carte de destination est déjà liée à un compte.",
  network: "Opération impossible. Réessayez.",
};

function dayFr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * Outil support : retrouver N'IMPORTE QUELLE carte par son numéro (ou l'URL de
 * son QR), voir son état, ses cagnottes et son journal, puis bloquer /
 * débloquer / transférer le solde d'une carte anonyme perdue vers une carte de
 * remplacement ou le QR d'un client — la main complète, sans SQL.
 */
export function LoyaltyCardTool() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<AdminCardLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [blockNote, setBlockNote] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function lookup(q?: string) {
    const value = (q ?? query).trim();
    if (!value) return;
    setSearching(true);
    setError(null);
    setActionMsg(null);
    try {
      const res = await adminLookupLoyaltyCard(value);
      if (!res.ok) {
        setResult(null);
        setError(REASON_FR[res.reason ?? ""] ?? REASON_FR.network);
        return;
      }
      setResult(res);
    } finally {
      setSearching(false);
    }
  }

  async function run(
    key: string,
    fn: () => Promise<{ ok: boolean; reason?: string }>,
    successMsg: string
  ) {
    setActionPending(key);
    setError(null);
    setActionMsg(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(REASON_FR[res.reason ?? ""] ?? REASON_FR.network);
        return;
      }
      setActionMsg(successMsg);
      if (result?.card) void lookup(result.card.card_code);
    } finally {
      setActionPending(null);
    }
  }

  const card = result?.card;
  const status = card ? STATUS_FR[card.status] : null;

  return (
    <section className="border-border bg-surface rounded-lg border p-4">
      <p className="flex items-center gap-2 text-sm font-bold">
        <Search className="text-primary-600 size-4" />
        Retrouver une carte
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void lookup();
            }
          }}
          placeholder="Numéro 16 caractères ou URL du QR"
          className="font-mono uppercase"
        />
        <Button
          disabled={searching || !query.trim()}
          onClick={() => void lookup()}
        >
          {searching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Chercher
        </Button>
      </div>

      {error && <p className="text-danger-600 mt-3 text-sm">{error}</p>}
      {actionMsg && (
        <p className="text-success-700 mt-3 text-sm font-semibold">
          {actionMsg}
        </p>
      )}

      {card && (
        <div className="border-border mt-4 space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-sm font-bold">
              {groupCardCode(card.card_code)}
            </p>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-bold",
                status?.cls
              )}
            >
              {status?.label}
            </span>
          </div>
          <p className="text-subtle text-xs">
            Créée {dayFr(card.created_at)} · activée {dayFr(card.activated_at)}{" "}
            · liée {dayFr(card.linked_at)}
            {card.status === "blocked" &&
              ` · bloquée ${dayFr(card.blocked_at)}${card.blocked_reason ? ` (${card.blocked_reason})` : ""}`}
          </p>

          {(result?.accounts ?? []).length > 0 && (
            <ul className="space-y-1">
              {(result?.accounts ?? []).map((a) => (
                <li
                  key={a.merchant_name}
                  className="bg-surface-2 flex items-center justify-between rounded-md px-3 py-2 text-sm"
                >
                  <span className="font-semibold">{a.merchant_name}</span>
                  <span className="tabular-nums">
                    {formatDA(a.balance_da)}
                    {a.vouchers_da > 0 &&
                      ` · ${formatDA(a.vouchers_da)} en bons`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(result?.events ?? []).length > 0 && (
            <p className="text-subtle text-xs">
              {(result?.events ?? [])
                .slice(0, 4)
                .map(
                  (e) =>
                    `${e.from ?? "création"} → ${e.to} (${e.actor}, ${dayFr(e.at)})`
                )
                .join(" · ")}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {card.status !== "blocked" ? (
              <>
                <Input
                  value={blockNote}
                  onChange={(e) => setBlockNote(e.target.value)}
                  placeholder="Motif (optionnel)"
                  className="h-9 max-w-[220px] text-sm"
                />
                <Button
                  variant="outline"
                  disabled={actionPending === "block"}
                  onClick={() =>
                    void run(
                      "block",
                      () =>
                        adminBlockLoyaltyCard(
                          card.id,
                          blockNote.trim() || null
                        ),
                      "Carte bloquée."
                    )
                  }
                  className="text-danger-600"
                >
                  {actionPending === "block" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Ban className="size-4" />
                  )}
                  Bloquer
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={actionPending === "unblock"}
                  onClick={() =>
                    void run(
                      "unblock",
                      () => adminUnblockLoyaltyCard(card.id),
                      "Carte débloquée."
                    )
                  }
                >
                  {actionPending === "unblock" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Undo2 className="size-4" />
                  )}
                  Débloquer
                </Button>
                {card.customer_id === null && (
                  <>
                    <Input
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      placeholder="Carte de remplacement ou QR client"
                      className="h-9 max-w-[260px] font-mono text-sm uppercase"
                    />
                    <Button
                      variant="outline"
                      disabled={
                        actionPending === "transfer" || !transferTo.trim()
                      }
                      onClick={() =>
                        void run(
                          "transfer",
                          async () => {
                            const res = await adminTransferLoyaltyCard(
                              card.id,
                              transferTo.trim(),
                              blockNote.trim() || null
                            );
                            if (res.ok) {
                              const total = (res.moved ?? []).reduce(
                                (s, m) => s + m.amount_da,
                                0
                              );
                              setActionMsg(
                                `Solde transféré (${formatDA(total)} sur ${res.moved?.length ?? 0} magasin(s)).`
                              );
                            }
                            return res;
                          },
                          "Solde transféré."
                        )
                      }
                    >
                      {actionPending === "transfer" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ArrowRightLeft className="size-4" />
                      )}
                      Transférer le solde
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
