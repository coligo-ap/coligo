"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Ban,
  ExternalLink,
  Loader2,
  Save,
  ShieldCheck,
  Snowflake,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  approveChauffeurGated,
  freezeChauffeurWithReason,
  getChauffeurDocUrl,
  rejectChauffeur,
  setChauffeurBlocked,
  setChauffeurDocStatus,
  setChauffeurFrozen,
  updateChauffeurInfo,
} from "@/app/admin/chauffeurs/actions";

/* ────────────────────────────────────────────────────────────────────────
   Fiche chauffeur (super-admin) — validation PIÈCE PAR PIÈCE puis
   activation du compte. Obligatoire : permis r/v, carte grise, plaque,
   selfie + identité complète. Facultatif : assurance, adresse, CCP.
   ──────────────────────────────────────────────────────────────────────── */

export type AdminChauffeurDoc = {
  id: string;
  kind: string;
  url: string;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const DOC_META: Record<string, { label: string; required: boolean }> = {
  permis_recto: { label: "Permis de conduire (recto)", required: true },
  permis_verso: { label: "Permis de conduire (verso)", required: true },
  carte_grise: { label: "Carte grise", required: true },
  plaque: { label: "Photo de la plaque", required: true },
  selfie: { label: "Selfie en direct", required: true },
  assurance: { label: "Assurance", required: false },
};

export function ChauffeurDocReview({
  chauffeurId,
  docs,
}: {
  chauffeurId: string;
  docs: AdminChauffeurDoc[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const byKind = new Map(docs.map((d) => [d.kind, d]));
  const kinds = Object.keys(DOC_META);

  const openDoc = (path: string) =>
    start(async () => {
      const res = await getChauffeurDocUrl(path);
      if (res.url) window.open(res.url, "_blank");
      else setError(res.error ?? "Document introuvable");
    });

  const review = (docId: string, status: "approved" | "rejected") =>
    start(async () => {
      setError(null);
      let note: string | null = null;
      if (status === "rejected") {
        note = window.prompt(
          "Motif du refus de cette pièce (transmis au chauffeur) :",
          "Photo illisible — reprenez-la."
        );
        if (note == null) return;
      }
      const res = await setChauffeurDocStatus(chauffeurId, docId, status, note);
      if (res.error) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="space-y-2">
      {kinds.map((kind) => {
        const meta = DOC_META[kind];
        const doc = byKind.get(kind);
        return (
          <div
            key={kind}
            className={cn(
              "border-border flex flex-wrap items-center gap-2 rounded-[12px] border p-3",
              doc?.status === "approved" && "border-success-300 bg-success-50",
              doc?.status === "rejected" && "border-danger-300 bg-danger-50"
            )}
          >
            <span className="min-w-0 flex-1">
              <b className="block text-sm">{meta.label}</b>
              <span className="text-muted text-xs">
                {meta.required ? "Obligatoire" : "Facultatif"}
                {doc?.reviewed_by &&
                  ` · examiné par ${doc.reviewed_by}${
                    doc.review_note ? ` — « ${doc.review_note} »` : ""
                  }`}
              </span>
            </span>
            {!doc ? (
              <span className="text-muted text-xs font-semibold">
                Non envoyé
              </span>
            ) : (
              <>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                    doc.status === "approved" && "bg-success-600 text-white",
                    doc.status === "rejected" && "bg-danger-600 text-white",
                    doc.status === "pending" &&
                      "bg-warning-100 text-warning-800"
                  )}
                >
                  {doc.status === "approved"
                    ? "Validé"
                    : doc.status === "rejected"
                      ? "Refusé"
                      : "À vérifier"}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => openDoc(doc.url)}
                  className="border-border hover:bg-surface-2 inline-flex items-center gap-1 rounded-[8px] border px-2 py-1 text-xs font-semibold"
                >
                  Voir <ExternalLink className="size-3" />
                </button>
                {doc.status !== "approved" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => review(doc.id, "approved")}
                    className="bg-success-600 rounded-[8px] px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Valider
                  </button>
                )}
                {doc.status !== "rejected" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => review(doc.id, "rejected")}
                    className="bg-danger-600 rounded-[8px] px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Refuser
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      {error && (
        <p className="text-danger-600 text-xs font-semibold">{error}</p>
      )}
    </div>
  );
}

/* ── Fiche éditable : véhicule, gamme, adresse, CCP, conductrice ── */

export function ChauffeurInfoForm({
  chauffeurId,
  initial,
}: {
  chauffeurId: string;
  initial: {
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_color: string | null;
    vehicle_plate: string | null;
    gamme: "classic" | "confort" | "moto";
    home_addr_text: string | null;
    ccp_number: string | null;
    ccp_key: string | null;
    is_female: boolean;
    is_female_verified: boolean;
  };
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const save = () =>
    start(async () => {
      setMsg({});
      const res = await updateChauffeurInfo(chauffeurId, f);
      setMsg(res.error ? { error: res.error } : { ok: "Fiche enregistrée ✓" });
      if (!res.error) router.refresh();
    });

  const inp = "border-border w-full rounded-[10px] border px-2.5 py-2 text-sm";
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <L label="Marque (carte grise)">
          <input
            className={inp}
            value={f.vehicle_make ?? ""}
            onChange={(e) => setF({ ...f, vehicle_make: e.target.value })}
          />
        </L>
        <L label="Modèle">
          <input
            className={inp}
            value={f.vehicle_model ?? ""}
            onChange={(e) => setF({ ...f, vehicle_model: e.target.value })}
          />
        </L>
        <L label="Couleur">
          <input
            className={inp}
            value={f.vehicle_color ?? ""}
            onChange={(e) => setF({ ...f, vehicle_color: e.target.value })}
          />
        </L>
        <L label="Plaque d'immatriculation">
          <input
            className={inp}
            value={f.vehicle_plate ?? ""}
            onChange={(e) => setF({ ...f, vehicle_plate: e.target.value })}
          />
        </L>
        <L label="Gamme">
          <select
            className={inp}
            value={f.gamme}
            onChange={(e) =>
              setF({ ...f, gamme: e.target.value as typeof f.gamme })
            }
          >
            <option value="classic">Classic</option>
            <option value="confort">Confort</option>
            <option value="moto">Moto</option>
          </select>
        </L>
        <L label="Adresse domicile (facultatif)">
          <input
            className={inp}
            value={f.home_addr_text ?? ""}
            onChange={(e) => setF({ ...f, home_addr_text: e.target.value })}
          />
        </L>
        <L label="CCP du chauffeur (facultatif — requis avant le 1er versement)">
          <input
            className={inp}
            placeholder="N° CCP"
            value={f.ccp_number ?? ""}
            onChange={(e) => setF({ ...f, ccp_number: e.target.value })}
          />
        </L>
        <L label="Clé CCP">
          <input
            className={inp}
            placeholder="Clé"
            value={f.ccp_key ?? ""}
            onChange={(e) => setF({ ...f, ccp_key: e.target.value })}
          />
        </L>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-4"
            checked={f.is_female}
            onChange={(e) => setF({ ...f, is_female: e.target.checked })}
          />
          Conductrice
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-4"
            checked={f.is_female_verified}
            onChange={(e) =>
              setF({ ...f, is_female_verified: e.target.checked })
            }
          />
          Conductrice VÉRIFIÉE (reçoit les demandes « Femme au volant »)
        </label>
      </div>
      {msg.error && (
        <p className="text-danger-600 text-xs font-semibold">{msg.error}</p>
      )}
      {msg.ok && (
        <p className="text-success-700 text-xs font-semibold">{msg.ok}</p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="bg-primary-700 inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-xs font-bold text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Save className="size-3.5" />
        )}
        Enregistrer la fiche
      </button>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold">
      <span className="text-muted mb-1 block">{label}</span>
      {children}
    </label>
  );
}

/* ── Actions de compte : activer (gaté), refuser, geler, bloquer ── */

export function ChauffeurAccountActions({
  chauffeurId,
  isVerified,
  isFrozen,
  isBlocked,
}: {
  chauffeurId: string;
  isVerified: boolean;
  isFrozen: boolean;
  isBlocked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const run = (fn: () => Promise<{ error?: string }>, okMsg: string) =>
    start(async () => {
      setMsg({});
      const res = await fn();
      setMsg(res.error ? { error: res.error } : { ok: okMsg });
      if (!res.error) router.refresh();
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!isVerified && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => approveChauffeurGated(chauffeurId),
                "Compte ACTIVÉ — le chauffeur peut travailler ✓"
              )
            }
            className="bg-success-600 inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-xs font-bold text-white disabled:opacity-50"
          >
            <ShieldCheck className="size-3.5" /> Activer le compte
          </button>
        )}
        {!isVerified && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const motif = window.prompt(
                "Motif du refus du dossier (transmis au chauffeur) :",
                "Documents incomplets — complétez puis renvoyez."
              );
              if (!motif) return;
              run(
                () => rejectChauffeur(chauffeurId, motif),
                "Dossier refusé (motif transmis)."
              );
            }}
            className="bg-danger-600 inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-xs font-bold text-white disabled:opacity-50"
          >
            <X className="size-3.5" /> Refuser le dossier
          </button>
        )}
        {isVerified && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (isFrozen) {
                run(
                  () => setChauffeurFrozen(chauffeurId, false),
                  "Compte dégelé ✓"
                );
              } else {
                const motif = window.prompt(
                  "Motif du gel (affiché au chauffeur) :",
                  "Comportement signalé / non-respect des conditions"
                );
                if (motif == null) return;
                run(
                  () => freezeChauffeurWithReason(chauffeurId, motif),
                  "Compte gelé."
                );
              }
            }}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-xs font-bold disabled:opacity-50",
              isFrozen
                ? "bg-warning-100 text-warning-800"
                : "bg-warning-500 text-white"
            )}
          >
            <Snowflake className="size-3.5" /> {isFrozen ? "Dégeler" : "Geler"}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => setChauffeurBlocked(chauffeurId, !isBlocked),
              isBlocked ? "Compte débloqué ✓" : "Compte BLOQUÉ."
            )
          }
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-xs font-bold disabled:opacity-50",
            isBlocked
              ? "bg-danger-100 text-danger-700"
              : "bg-danger-600 text-white"
          )}
        >
          <Ban className="size-3.5" /> {isBlocked ? "Débloquer" : "Bloquer"}
        </button>
        {isVerified && !isFrozen && !isBlocked && (
          <span className="text-success-700 inline-flex items-center gap-1 text-xs font-bold">
            <BadgeCheck className="size-4" /> Compte actif — reçoit des courses
          </span>
        )}
      </div>
      {msg.error && (
        <p className="text-danger-600 text-xs font-semibold">{msg.error}</p>
      )}
      {msg.ok && (
        <p className="text-success-700 text-xs font-semibold">{msg.ok}</p>
      )}
    </div>
  );
}
