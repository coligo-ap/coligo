import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireAdminDomain } from "@/lib/auth/admin";
import { getRecruteDrafts } from "@/lib/data/recrute-content";
import { RecruteManager } from "@/components/admin/marketing/recrute-manager";

export const dynamic = "force-dynamic";

/**
 * Onglet « Page recrutement » du hub Marketing : habillage et contenu de la
 * page publique /recrute. La lecture est NON cachée ici (contrairement à la
 * page publique) — l'équipe doit voir ce qui est réellement enregistré, un
 * champ vide signifiant « valeur livrée avec l'application ».
 */
export default async function AdminRecrutementTab() {
  await requireAdminDomain("marketing");
  const drafts = await getRecruteDrafts();

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted text-body-sm max-w-xl leading-relaxed">
          Photos, textes et habillage de la page publique de recrutement. Pour
          masquer complètement un métier, c&apos;est dans{" "}
          <Link
            href="/admin/controle"
            className="text-primary-700 font-semibold"
          >
            Contrôle des services
          </Link>{" "}
          — ici on habille, on ne coupe pas.
        </p>
        <Link
          href="/recrute"
          target="_blank"
          rel="noreferrer"
          className="border-border hover:bg-surface-2 rounded-control text-label-lg inline-flex h-9 shrink-0 items-center gap-1.5 border px-3 font-semibold"
        >
          Voir la page
          <ExternalLink className="size-3.5" />
        </Link>
      </div>

      <RecruteManager
        initialDesign={drafts.design}
        initialHeroTitle={drafts.heroTitle}
        initialHeroSubtitle={drafts.heroSubtitle}
        initialRoles={drafts.roles}
      />
    </div>
  );
}
