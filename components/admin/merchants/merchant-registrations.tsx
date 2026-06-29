"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import type { AdminMerchant } from "@/lib/data/platform";
import { decideMerchantApproval } from "@/app/admin/actions";

// =============================================================================
// Onglet « Inscriptions » du hub Commerçants (mig 0273) : file de validation
// des nouvelles inscriptions commerçant. Une demande en attente reste invisible
// des clients et ne peut pas recevoir de commande tant qu'elle n'est pas
// approuvée. Les demandes refusées restent réexaminables (ré-approbation).
// =============================================================================

function formatSubmitted(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

export function MerchantRegistrations({
  merchants,
}: {
  merchants: AdminMerchant[];
}) {
  const pending = useMemo(
    () => merchants.filter((m) => m.approval_status === "pending"),
    [merchants]
  );
  const rejected = useMemo(
    () => merchants.filter((m) => m.approval_status === "rejected"),
    [merchants]
  );

  return (
    <div className="space-y-6">
      <p className="text-muted text-sm">
        Validez les nouvelles inscriptions commerçant. Tant qu&apos;une demande
        n&apos;est pas approuvée, la boutique reste{" "}
        <strong className="text-foreground">
          invisible des clients et ne peut pas recevoir de commande
        </strong>
        .
      </p>

      {/* À TRAITER */}
      <section className="border-warning-200 bg-warning-50/60 rounded-[16px] border p-4 lg:p-5">
        <h2 className="text-warning-900 mb-1 flex items-center gap-2 text-base font-bold">
          <Clock className="size-4" />
          Demandes à traiter ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted mt-2 text-sm">
            Aucune inscription en attente. Tout est traité ✅
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {pending.map((m) => (
              <RegistrationCard key={m.id} merchant={m} />
            ))}
          </ul>
        )}
      </section>

      {/* REFUSÉES (réexaminables) */}
      {rejected.length > 0 && (
        <section className="border-border bg-surface rounded-[16px] border p-4 lg:p-5">
          <h2 className="text-foreground mb-1 flex items-center gap-2 text-base font-bold">
            <XCircle className="text-danger-500 size-4" />
            Refusées ({rejected.length})
          </h2>
          <p className="text-muted mb-3 text-sm">
            Demandes refusées — tu peux les réexaminer et approuver si besoin.
          </p>
          <ul className="space-y-2">
            {rejected.map((m) => (
              <RegistrationCard key={m.id} merchant={m} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RegistrationCard({ merchant }: { merchant: AdminMerchant }) {
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [pending, startTransition] = useTransition();
  const isRejected = merchant.approval_status === "rejected";

  const run = (decision: "approve" | "reject", reason?: string) =>
    startTransition(async () => {
      const res = await decideMerchantApproval(merchant.id, decision, reason);
      if (res.error) return toast.error(res.error);
      toast.success(
        decision === "approve"
          ? `« ${merchant.name} » approuvé — la boutique est en ligne`
          : `« ${merchant.name} » refusé`
      );
      router.refresh();
    });

  const askApprove = async () => {
    const ok = await confirm({
      title: isRejected
        ? "Approuver malgré le refus ?"
        : "Approuver ce commerçant ?",
      message: `« ${merchant.name} » deviendra visible des clients et pourra recevoir des commandes.`,
      confirmLabel: "Approuver",
    });
    if (ok) run("approve");
  };

  const askReject = async () => {
    const reason = await prompt({
      title: "Refuser cette demande ?",
      message: `Motif communiqué à « ${merchant.name} » (facultatif).`,
      placeholder: "Ex. dossier incomplet, hors zone…",
      confirmLabel: "Refuser",
    });
    if (reason !== null) run("reject", reason);
  };

  const loc = [merchant.city].filter(Boolean).join(", ");

  return (
    <li className="border-border bg-surface rounded-[14px] border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{merchant.name}</h3>
            {merchant.category && (
              <Badge tone="neutral">{merchant.category}</Badge>
            )}
            {isRejected && <Badge tone="danger">Refusé</Badge>}
          </div>
          <div className="text-muted mt-1 space-y-0.5 text-xs">
            {loc && (
              <p className="flex items-center gap-1.5">
                <MapPin className="size-3" />
                {loc}
              </p>
            )}
            {merchant.email && (
              <p className="flex items-center gap-1.5">
                <Mail className="size-3" />
                <span className="truncate">{merchant.email}</span>
              </p>
            )}
            {merchant.phone && (
              <p className="flex items-center gap-1.5">
                <Phone className="size-3" />
                {merchant.phone}
              </p>
            )}
            <p className="text-subtle">
              Demande du {formatSubmitted(merchant.submitted_at)}
            </p>
            {isRejected && merchant.rejected_reason && (
              <p className="text-danger-600">
                Motif : {merchant.rejected_reason}
              </p>
            )}
          </div>
        </div>

        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          {!isRejected && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={askReject}
              className="text-danger-600 hover:bg-danger-50"
            >
              <XCircle className="size-4" />
              Refuser
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={askApprove}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isRejected ? (
              <RotateCcw className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {isRejected ? "Réexaminer & approuver" : "Approuver"}
          </Button>
        </div>
      </div>
    </li>
  );
}
