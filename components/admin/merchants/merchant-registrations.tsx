"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  EyeOff,
  Hourglass,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  UserRound,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import type { AdminMerchant, AdminSignupDraft } from "@/lib/data/platform";
import {
  decideMerchantApproval,
  dismissSignupDraft,
} from "@/app/admin/actions";
import { getWilaya } from "@/lib/config/wilayas";

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

/** « il y a X min/h/j » — texte relatif court pour la dernière activité. */
function timeAgo(iso: string): string {
  const mins = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  );
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function MerchantRegistrations({
  merchants,
  drafts = [],
  catLabels = {},
}: {
  merchants: AdminMerchant[];
  /** Brouillons du wizard d'inscription non finalisés (mig 0414). */
  drafts?: AdminSignupDraft[];
  /** code catégorie → libellé (affichage des types choisis). */
  catLabels?: Record<string, string>;
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
      <section
        data-alert-focus="merchants_pending"
        className="border-warning-200 bg-warning-50/60 rounded-[16px] border p-4 lg:p-5"
      >
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

      {/* COMMENCÉES NON FINALISÉES (brouillons wizard, mig 0414) */}
      {drafts.length > 0 && (
        <section className="border-border bg-surface rounded-[16px] border p-4 lg:p-5">
          <h2 className="text-foreground mb-1 flex items-center gap-2 text-base font-bold">
            <Hourglass className="text-primary-600 size-4" />
            Commencées, non finalisées ({drafts.length})
          </h2>
          <p className="text-muted mb-3 text-sm">
            Inscriptions abandonnées en cours de route (enregistrées à chaque
            étape du formulaire) — recontacte-les pour les aider à terminer.
          </p>
          <ul className="space-y-2">
            {drafts.map((d) => (
              <DraftCard key={d.id} draft={d} catLabels={catLabels} />
            ))}
          </ul>
        </section>
      )}

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
  const [note, setNote] = useActionNote();
  const isRejected = merchant.approval_status === "rejected";

  const run = (decision: "approve" | "reject", reason?: string) =>
    startTransition(async () => {
      const res = await decideMerchantApproval(merchant.id, decision, reason);
      // Succès : la fiche change de statut (approuvé/refusé) via refresh.
      if (res.error) return setNote({ ok: false, text: res.error });
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
        <ActionNote note={note} className="mt-2" />
      </div>
    </li>
  );
}

/**
 * Brouillon d'inscription non finalisée : tout ce qu'on sait du commerçant
 * (téléphone dès l'étape 1, position GPS…) pour le recontacter, + « Ignorer ».
 */
function DraftCard({
  draft,
  catLabels,
}: {
  draft: AdminSignupDraft;
  catLabels: Record<string, string>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useActionNote();

  const askDismiss = async () => {
    const ok = await confirm({
      title: "Ignorer cette inscription ?",
      message:
        "Elle disparaîtra de la liste à recontacter (déjà traitée, injoignable ou spam).",
      confirmLabel: "Ignorer",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await dismissSignupDraft(draft.id);
      if (res.error) return setNote({ ok: false, text: res.error });
      router.refresh();
    });
  };

  const wilayaName = draft.wilaya_code
    ? (getWilaya(draft.wilaya_code)?.name ?? null)
    : null;
  const loc = [draft.city, wilayaName].filter(Boolean).join(", ");
  const types = draft.categories.map((c) => catLabels[c] ?? c);
  const hasGps = draft.latitude != null && draft.longitude != null;

  return (
    <li className="border-border bg-surface rounded-[14px] border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {draft.merchant_name ?? "Commerce sans nom"}
            </h3>
            <Badge tone="warning">
              Étape {Math.min(draft.step_reached, draft.steps_total)}/
              {draft.steps_total}
            </Badge>
            {draft.source === "google" && <Badge tone="neutral">Google</Badge>}
            {types.map((t) => (
              <Badge key={t} tone="neutral">
                {t}
              </Badge>
            ))}
          </div>
          <div className="text-muted mt-1 space-y-0.5 text-xs">
            {draft.manager_name && (
              <p className="flex items-center gap-1.5">
                <UserRound className="size-3" />
                {draft.manager_name}
              </p>
            )}
            {draft.phone && (
              <p className="flex items-center gap-1.5">
                <Phone className="size-3" />
                <a
                  href={`tel:${draft.phone}`}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {draft.phone}
                </a>
              </p>
            )}
            {draft.email && (
              <p className="flex items-center gap-1.5">
                <Mail className="size-3" />
                <a
                  href={`mailto:${draft.email}`}
                  className="truncate hover:underline"
                >
                  {draft.email}
                </a>
              </p>
            )}
            {(loc || draft.address || hasGps) && (
              <p className="flex flex-wrap items-center gap-1.5">
                <MapPin className="size-3" />
                <span className="truncate">
                  {[draft.address, loc].filter(Boolean).join(" — ") ||
                    "Position GPS enregistrée"}
                </span>
                {hasGps && (
                  <a
                    href={`https://www.google.com/maps?q=${draft.latitude},${draft.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-700 font-medium hover:underline"
                  >
                    Voir la position
                  </a>
                )}
              </p>
            )}
            <p className="text-subtle" suppressHydrationWarning>
              Commencée le {formatSubmitted(draft.created_at)} · dernière
              activité {timeAgo(draft.updated_at)}
            </p>
          </div>
        </div>

        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={askDismiss}
            className="text-muted"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <EyeOff className="size-4" />
            )}
            Ignorer
          </Button>
        </div>
        <ActionNote note={note} className="mt-2" />
      </div>
    </li>
  );
}
