"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Check,
  Loader2,
  Pause,
  Play,
  Save,
  ShieldX,
  Slash,
  X,
} from "lucide-react";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CollapsibleSection } from "@/components/admin/shared/collapsible-section";
import { DecisionNoteDialog } from "@/components/admin/doc-viewer";
import {
  approveAgent,
  rejectAgent,
  setAgentStatus,
  setAgentVerified,
  updateAgent,
} from "@/app/admin/agents/actions";

export type AgentInfo = {
  id: string;
  displayName: string;
  ownerName: string | null;
  registreCommerce: string | null;
  phone: string | null;
  address: string | null;
  wilaya: string | null;
  commune: string | null;
  hours: string | null;
  status: string;
  isVerified: boolean;
};

export function AgentReviewPanel({ agent }: { agent: AgentInfo }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useActionNote();

  const run = (fn: () => Promise<{ ok?: true; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) setNote({ ok: false, text: r.error });
      else {
        setNote({ ok: true, text: ok });
        router.refresh();
      }
    });

  const notActive = agent.status !== "active";

  return (
    <div className="space-y-4">
      {/* ===== Décisions ===== */}
      <div className="border-border bg-surface rounded-card-lg border p-4 shadow-sm">
        <h2 className="text-foreground mb-3 text-sm font-bold">Décision</h2>
        <div className="flex flex-wrap gap-2">
          {notActive && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => approveAgent(agent.id),
                  "Dossier approuvé — point actif"
                )
              }
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Approuver (activer)
            </Button>
          )}

          {agent.status !== "rejected" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setRejecting(true)}
              className="text-danger-700"
            >
              <X className="size-3.5" />
              Refuser le dossier
            </Button>
          )}

          <Button
            size="sm"
            variant={agent.isVerified ? "secondary" : "default"}
            disabled={pending}
            onClick={() =>
              run(
                () => setAgentVerified(agent.id, !agent.isVerified),
                agent.isVerified ? "Vérification retirée" : "Agent vérifié ✓"
              )
            }
          >
            {agent.isVerified ? (
              <ShieldX className="size-3.5" />
            ) : (
              <BadgeCheck className="size-3.5" />
            )}
            {agent.isVerified ? "Retirer la vérification" : "Marquer vérifié"}
          </Button>
        </div>

        {/* Contrôles d'état pour un agent déjà actif/suspendu */}
        {(agent.status === "active" ||
          agent.status === "suspended" ||
          agent.status === "disabled") && (
          <div className="border-border mt-3 flex flex-wrap gap-2 border-t pt-3">
            {agent.status !== "active" && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setAgentStatus(agent.id, "active"),
                    "Point réactivé"
                  )
                }
              >
                <Play className="size-3.5" /> Réactiver
              </Button>
            )}
            {agent.status !== "suspended" && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setAgentStatus(agent.id, "suspended"),
                    "Point suspendu"
                  )
                }
              >
                <Pause className="size-3.5" /> Suspendre
              </Button>
            )}
            {agent.status !== "disabled" && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setAgentStatus(agent.id, "disabled"),
                    "Point désactivé"
                  )
                }
                className="text-danger-700"
              >
                <Slash className="size-3.5" /> Désactiver
              </Button>
            )}
          </div>
        )}
      </div>

      <ActionNote note={note} />

      {/* ===== Édition des informations ===== */}
      <AgentEditForm agent={agent} pending={pending} run={run} />

      {rejecting && (
        <DecisionNoteDialog
          decision="rejected"
          docTitle="le dossier"
          onConfirm={async (note) => {
            const r = await rejectAgent(agent.id, note ?? "");
            // Succès : le statut passe à « refusé » via refresh (visuel).
            // L'erreur est gérée par DecisionNoteDialog via `r`.
            if (!r.error) router.refresh();
            return r;
          }}
          onClose={() => setRejecting(false)}
        />
      )}
    </div>
  );
}

function AgentEditForm({
  agent,
  pending,
  run,
}: {
  agent: AgentInfo;
  pending: boolean;
  run: (fn: () => Promise<{ ok?: true; error?: string }>, ok: string) => void;
}) {
  const [f, setF] = useState({
    displayName: agent.displayName,
    ownerName: agent.ownerName ?? "",
    registreCommerce: agent.registreCommerce ?? "",
    phone: agent.phone ?? "",
    address: agent.address ?? "",
    wilaya: agent.wilaya ?? "",
    commune: agent.commune ?? "",
    hours: agent.hours ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <CollapsibleSection
      icon={<Save className="size-4" />}
      title="Informations du point"
    >
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nom du point">
          <Input value={f.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="Gérant">
          <Input value={f.ownerName} onChange={set("ownerName")} />
        </Field>
        <Field label="Registre de commerce">
          <Input
            value={f.registreCommerce}
            onChange={set("registreCommerce")}
          />
        </Field>
        <Field label="Téléphone">
          <Input value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label="Wilaya">
          <Input value={f.wilaya} onChange={set("wilaya")} />
        </Field>
        <Field label="Commune">
          <Input value={f.commune} onChange={set("commune")} />
        </Field>
        <Field label="Adresse" full>
          <Input value={f.address} onChange={set("address")} />
        </Field>
        <Field label="Horaires" full>
          <Input value={f.hours} onChange={set("hours")} />
        </Field>
      </div>
      <div className="mt-3">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => updateAgent(agent.id, f), "Informations mises à jour")
          }
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Enregistrer les modifications
        </Button>
      </div>
    </CollapsibleSection>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
