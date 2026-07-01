import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Phone, UserRound } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
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
  await requireSuperAdmin();
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
      "id, owner_type, display_name, owner_name, registre_commerce, phone, address, wilaya, commune, hours, lat, lng, status, is_verified, submitted_at, created_at"
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
      <div className="border-border bg-surface rounded-[16px] border p-4 shadow-sm">
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

      {/* Pièces du dossier */}
      <div className="border-border bg-surface rounded-[16px] border p-4 shadow-sm">
        <h2 className="text-foreground mb-3 text-sm font-bold">
          Pièces du dossier
        </h2>
        <AgentDocumentsManager walletId={wallet.id} documents={documents} />
      </div>

      {/* Décisions + édition */}
      <AgentReviewPanel agent={info} />
    </div>
  );
}
