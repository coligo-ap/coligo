import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileCheck, MapPin, Phone, UserRound } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminDomain } from "@/lib/auth/admin";
import { CollapsibleSection } from "@/components/admin/shared/collapsible-section";
import { AgentStatusBadge } from "@/components/admin/agents/agent-status-badge";
import {
  AgentReviewPanel,
  type AgentInfo,
} from "@/components/admin/agents/agent-review-panel";
import {
  AgentDocumentsManager,
  type AgentDocument,
} from "@/components/admin/agents/agent-documents-manager";

export const dynamic = "force-dynamic";

type WalletRow = {
  id: string;
  owner_type: string;
  display_name: string | null;
  owner_name: string | null;
  registre_commerce: string | null;
  phone: string | null;
  address: string | null;
  wilaya: string | null;
  commune: string | null;
  hours: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  is_verified: boolean | null;
  submitted_at: string | null;
  created_at: string;
  rejected_reason: string | null;
};

type DocRow = {
  id: string;
  kind: string;
  label: string | null;
  url: string;
  status: string;
  review_note: string | null;
  created_at: string;
};

export default async function AdminAgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminDomain("finances");
  const { id } = await params;
  const admin = createAdminClient();

  const { data: wallet } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => { maybeSingle: () => Promise<{ data: WalletRow | null }> };
      };
    }
  )("operator_wallets")
    .select(
      "id, owner_type, display_name, owner_name, registre_commerce, phone, address, wilaya, commune, hours, lat, lng, status, is_verified, submitted_at, created_at, rejected_reason"
    )
    .eq("id", id)
    .maybeSingle();

  if (!wallet || wallet.owner_type !== "partner") notFound();

  const { data: docRows } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => Promise<{ data: DocRow[] | null }>;
        };
      };
    }
  )("partner_documents")
    .select("id, kind, label, url, status, review_note, created_at")
    .eq("wallet_id", id)
    .order("created_at", { ascending: false });

  // URLs signées (1 h) pour l'aperçu des pièces (bucket privé).
  const documents: AgentDocument[] = await Promise.all(
    (docRows ?? []).map(async (d) => {
      let scanUrl: string | null = null;
      if (d.url) {
        const { data: signed } = await admin.storage
          .from("partner-docs")
          .createSignedUrl(d.url, 3600);
        scanUrl = signed?.signedUrl ?? null;
      }
      return {
        id: d.id,
        kind: d.kind,
        label: d.label,
        status: d.status,
        review_note: d.review_note,
        scanUrl,
        createdAt: d.created_at,
      };
    })
  );

  const info: AgentInfo = {
    id: wallet.id,
    displayName: wallet.display_name ?? "",
    ownerName: wallet.owner_name,
    registreCommerce: wallet.registre_commerce,
    phone: wallet.phone,
    address: wallet.address,
    wilaya: wallet.wilaya,
    commune: wallet.commune,
    hours: wallet.hours,
    status: wallet.status,
    isVerified: !!wallet.is_verified,
  };

  const loc = [wallet.commune, wallet.wilaya].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Link
        href="/admin/agents"
        className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" /> Tous les agents
      </Link>

      {/* En-tête */}
      <div className="border-border bg-surface rounded-lg border p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-foreground text-lg font-bold">
              {wallet.display_name ?? "Point sans nom"}
            </h1>
            <div className="text-muted mt-1 space-y-0.5 text-sm">
              <p className="flex items-center gap-1.5">
                <UserRound className="size-3.5" />
                {wallet.owner_name ?? "Gérant non renseigné"}
              </p>
              {wallet.phone && (
                <p className="flex items-center gap-1.5">
                  <Phone className="size-3.5" />
                  {wallet.phone}
                </p>
              )}
              {(loc || wallet.address) && (
                <p className="flex items-center gap-1.5">
                  <MapPin className="size-3.5" />
                  {[wallet.address, loc].filter(Boolean).join(" — ")}
                </p>
              )}
              {wallet.registre_commerce && (
                <p className="text-xs">RC : {wallet.registre_commerce}</p>
              )}
            </div>
          </div>
          <AgentStatusBadge
            status={wallet.status}
            isVerified={wallet.is_verified}
          />
        </div>
        {wallet.lat != null && wallet.lng != null && (
          <a
            href={`https://www.openstreetmap.org/?mlat=${wallet.lat}&mlon=${wallet.lng}#map=17/${wallet.lat}/${wallet.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-700 mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline"
          >
            <MapPin className="size-3.5" /> Voir l&apos;emplacement sur la carte
          </a>
        )}
      </div>

      {/* Bannière d'état : l'admin voit d'un coup d'œil l'EFFET RÉEL du
          statut (mêmes règles que operator_can_operate / coligo_recharge_sell
          / recharge_points_nearby côté SQL), et où le lever. */}
      {(wallet.status === "suspended" || wallet.status === "disabled") && (
        <p className="border-danger-200 bg-danger-50 text-danger-800 rounded-md border p-3 text-sm">
          Point{" "}
          <strong>
            {wallet.status === "suspended" ? "suspendu" : "désactivé"}
          </strong>{" "}
          — il n&apos;apparaît plus sur la carte Coligo Pay et toute vente de
          recharge est refusée. L&apos;agent voit « Compte{" "}
          {wallet.status === "suspended" ? "suspendu" : "désactivé"} » dans son
          espace. « Réactiver » dans la section Décision ci-dessous.
        </p>
      )}
      {wallet.status === "rejected" && (
        <p className="border-warning-200 bg-warning-50 text-warning-800 rounded-md border p-3 text-sm">
          Dossier <strong>refusé</strong>
          {wallet.rejected_reason ? (
            <>
              {" "}
              — motif communiqué : <em>{wallet.rejected_reason}</em>
            </>
          ) : null}
          . L&apos;agent peut corriger ses pièces puis renvoyer.
        </p>
      )}

      {/* Pièces du dossier — repliable : ouvert tant que le point n'est pas
          actif/vérifié (revue en cours), replié ensuite. */}
      <CollapsibleSection
        icon={<FileCheck className="size-4" />}
        title="Pièces du dossier"
        count={documents.length}
        defaultOpen={wallet.status !== "active" || !wallet.is_verified}
      >
        <div className="mt-3">
          <AgentDocumentsManager walletId={wallet.id} documents={documents} />
        </div>
      </CollapsibleSection>

      {/* Décisions + édition */}
      <AgentReviewPanel agent={info} />
    </div>
  );
}
