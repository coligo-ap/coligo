"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileText,
  IdCard,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getMyPartnerDocuments,
  submitPartnerDocument,
  type PartnerDoc,
} from "@/app/(partner)/actions";

type Kind = "registre_commerce" | "piece_identite" | "autre";

const REQUIRED: { kind: Kind; label: string; icon: React.ReactNode }[] = [
  {
    kind: "registre_commerce",
    label: "Registre de commerce",
    icon: <FileText className="size-4" />,
  },
  {
    kind: "piece_identite",
    label: "Pièce d'identité du gérant",
    icon: <IdCard className="size-4" />,
  },
];

const STATUS_META: Record<
  PartnerDoc["status"],
  { label: string; cls: string; icon: React.ReactNode }
> = {
  pending: {
    label: "En vérification",
    cls: "bg-warning-100 text-warning-700",
    icon: <Clock className="size-3.5" />,
  },
  approved: {
    label: "Validée",
    cls: "bg-success-100 text-success-700",
    icon: <CheckCircle2 className="size-3.5" />,
  },
  rejected: {
    label: "Refusée",
    cls: "bg-danger-100 text-danger-700",
    icon: <XCircle className="size-3.5" />,
  },
};

/**
 * « Mon dossier » : l'agent dépose / remplace les pièces requises (registre de
 * commerce, pièce d'identité). Upload direct dans SON dossier (RLS storage =
 * wallet_id), puis enregistrement via RPC SECURITY DEFINER (statut 'pending').
 * Il voit le statut de chaque pièce et le motif d'un éventuel refus.
 */
export function DossierSection({ walletId }: { walletId: string }) {
  const [docs, setDocs] = useState<PartnerDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await getMyPartnerDocuments();
    setDocs(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Dernière pièce déposée par type (l'admin examine la plus récente).
  const latest = (kind: Kind): PartnerDoc | null =>
    docs.find((d) => d.kind === kind) ?? null;

  // ANTI-FRAUDE : dossier entièrement validé → plus de liste ni d'upload,
  // un seul message. La liste ne réapparaît que si l'équipe Coligo rejette
  // une pièce (demande de modification, motif affiché).
  const allApproved = REQUIRED.every(
    (r) => latest(r.kind)?.status === "approved"
  );

  return (
    <div className="border-border bg-surface rounded-lg border p-4">
      <h2 className="text-foreground mb-1 text-sm font-bold">Mon dossier</h2>
      {loading ? (
        <div className="text-muted flex items-center gap-2 py-3 text-sm">
          <Loader2 className="size-4 animate-spin" /> Chargement…
        </div>
      ) : allApproved ? (
        <div className="border-success-200 bg-success-50 mt-2 rounded-md border px-4 py-6 text-center">
          <CheckCircle2 className="text-success-600 mx-auto mb-2 size-6" />
          <p className="text-foreground text-sm font-bold">
            Tous vos documents sont validés et à jour
          </p>
          <p className="text-muted mt-1 text-xs">
            Rien à faire de votre côté. Si une pièce doit être mise à jour,
            l&apos;équipe Coligo vous enverra une demande de modification.
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted mb-3 text-xs">
            Ajoutez les pièces demandées. Coligo les vérifie avant
            d&apos;activer votre point.
          </p>
          <div className="space-y-2.5">
            {REQUIRED.map((r) => (
              <DocRow
                key={r.kind}
                walletId={walletId}
                kind={r.kind}
                label={r.label}
                icon={r.icon}
                doc={latest(r.kind)}
                onDone={refresh}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DocRow({
  walletId,
  kind,
  label,
  icon,
  doc,
  onDone,
}: {
  walletId: string;
  kind: Kind;
  label: string;
  icon: React.ReactNode;
  doc: PartnerDoc | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadingRef = useRef(false);

  const onPick = async (file: File) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      if (file.size > 10 * 1024 * 1024) {
        setErr("Fichier trop volumineux (10 Mo max).");
        return;
      }
      const supabase = createClient();
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${walletId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("partner-docs")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setErr(`Téléversement échoué : ${upErr.message}`);
        return;
      }
      const res = await submitPartnerDocument({ kind, path });
      if (!res.ok) {
        setErr(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      onDone();
    } finally {
      uploadingRef.current = false;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const meta = doc ? STATUS_META[doc.status] : null;
  // On peut (re)déposer tant qu'aucune pièce n'est validée.
  const canUpload = !doc || doc.status === "rejected";

  return (
    <div className="border-border rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <span className="text-primary-600">{icon}</span>
          {label}
        </span>
        {meta && (
          <span
            className={`text-micro inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${meta.cls}`}
          >
            {meta.icon}
            {meta.label}
          </span>
        )}
      </div>

      {doc?.status === "rejected" && doc.reviewNote && (
        <p className="text-danger-600 mt-1.5 text-xs">
          Motif : {doc.reviewNote}
        </p>
      )}

      {canUpload && (
        <div className="mt-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="border-primary-200 text-primary-700 hover:bg-primary-50 rounded-control inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {doc ? "Remplacer la pièce" : "Ajouter la pièce"}
          </button>
        </div>
      )}

      {err && <p className="text-danger-700 mt-1.5 text-xs">{err}</p>}
    </div>
  );
}
