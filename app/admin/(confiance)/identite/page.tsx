import { getFeatureFlag } from "@/lib/data/feature-flags";
import { adminCan } from "@/lib/auth/admin";
import {
  getIdvModesFullAdmin,
  getIdvProfileRulesAdmin,
  getIdvSettingsAudit,
  type IdvSettingsAuditEntry,
} from "@/lib/idv/admin-data";
import { FeatureFlagCard } from "@/components/admin/feature-flags-form";
import { IdvProfileRuleCard } from "@/components/admin/idv/idv-profile-rule-card";
import { IdvModeCard } from "@/components/admin/idv/idv-mode-card";

export const dynamic = "force-dynamic";

// =============================================================================
// /admin/identite — pilotage de la vérification d'identité automatisée (IDV).
// Gate domaine « confiance » par le layout du groupe. La PUBLICATION globale
// (feature flag) relève du domaine « plateforme » : la carte n'est éditable
// que si la session l'a aussi — sinon, statut en lecture seule.
// =============================================================================

const PROFILE_META: Record<string, { label: string; hint: string }> = {
  driver: {
    label: "Livreurs",
    hint: "Vérification d'identité des livreurs (marketplace + express).",
  },
  chauffeur: {
    label: "Chauffeurs (Drive)",
    hint: "Vérification d'identité des chauffeurs Coligo Drive.",
  },
  merchant: {
    label: "Commerçants",
    hint: "Vérification d'identité du titulaire du commerce.",
  },
};

const FLAG_STATUS_LABEL: Record<string, string> = {
  active: "Publiée",
  hidden: "Non publiée (masquée)",
  coming_soon: "Annoncée « bientôt »",
  maintenance: "En maintenance",
};

const dtf = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Algiers",
});

/** Un changement du journal, rendu compact : `champ : avant → après`. */
function changeLine(field: string, c: { from: unknown; to: unknown }): string {
  const fmt = (v: unknown): string => {
    if (v == null) return "—";
    if (typeof v === "number" && v >= 0 && v <= 1 && field !== "max_attempts") {
      return `${Math.round(v * 1000) / 10} %`;
    }
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return `${field} : ${fmt(c.from)} → ${fmt(c.to)}`;
}

function auditTargetLabel(
  entry: IdvSettingsAuditEntry,
  modeLabels: Map<string, string>
): string {
  const target = entry.metadata?.target ?? entry.reason ?? "";
  const [table, key] = target.split("/");
  if (table === "idv_profile_rules")
    return `Profil · ${PROFILE_META[key]?.label ?? key}`;
  if (table === "idv_modes") return `Mode · ${modeLabels.get(key) ?? key}`;
  return target || "Réglages";
}

export default async function AdminIdentitePage() {
  const [flag, canPlateforme, modes, rules, audit] = await Promise.all([
    getFeatureFlag("identity_verification"),
    adminCan("plateforme"),
    getIdvModesFullAdmin(),
    getIdvProfileRulesAdmin(),
    getIdvSettingsAudit(15),
  ]);

  const modeOptions = modes.map((m) => ({
    key: m.key,
    label_fr: m.label_fr,
    enabled: m.enabled,
  }));
  const modeLabels = new Map(modes.map((m) => [m.key, m.label_fr]));

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-5 lg:px-6">
      {/* ── Publication ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="font-bold tracking-tight">
            Vérification d&apos;identité
          </h2>
          <p className="text-muted mt-0.5 text-sm">
            Parcours automatisé document + selfie (analyse, présence réelle,
            comparaison du visage). Publication globale ci-dessous, règles par
            profil et seuils de décision ensuite.
          </p>
        </div>
        {canPlateforme ? (
          <FeatureFlagCard
            flag={flag}
            label="Publication de la fonctionnalité"
            hint="Masqué = retirée partout (aucun parcours proposé). Actif = disponible pour les profils configurés ci-dessous."
          />
        ) : (
          <div className="border-border bg-surface rounded-[16px] border p-4 text-sm">
            Publication :{" "}
            <span className="font-semibold">
              {FLAG_STATUS_LABEL[flag.status] ?? flag.status}
            </span>
            <p className="text-muted mt-1 text-xs">
              La publication se gère dans le domaine Plateforme (Contrôle).
            </p>
          </div>
        )}
      </section>

      {/* ── Règles par profil ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="font-bold tracking-tight">Profils concernés</h2>
          <p className="text-muted mt-0.5 text-sm">
            Qui doit vérifier son identité : obligatoire, facultatif, ou
            désactivé.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {rules.map((rule) => (
            <IdvProfileRuleCard
              key={rule.profile}
              rule={rule}
              modes={modeOptions}
              label={PROFILE_META[rule.profile]?.label ?? rule.profile}
              hint={PROFILE_META[rule.profile]?.hint ?? ""}
            />
          ))}
        </div>
      </section>

      {/* ── Modes & seuils ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="font-bold tracking-tight">
            Contrôles &amp; seuils de décision
          </h2>
          <p className="text-muted mt-0.5 text-sm">
            {modes.length > 1
              ? "Contrôles exécutés et zones de décision automatique de chaque mode."
              : "Une seule vérification, la complète : tous les contrôles s'exécutent pour tout le monde."}{" "}
            Entre le refus et l&apos;approbation : revue humaine.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {modes.map((mode) => (
            <IdvModeCard key={mode.key} mode={mode} />
          ))}
        </div>
      </section>

      {/* ── Journal des réglages ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="font-bold tracking-tight">Derniers changements</h2>
          <p className="text-muted mt-0.5 text-sm">
            Journal d&apos;audit append-only des réglages (15 derniers).
          </p>
        </div>
        <div className="border-border bg-surface overflow-hidden rounded-[16px] border">
          {audit.length === 0 ? (
            <p className="text-muted p-4 text-sm">
              Aucune modification enregistrée pour le moment.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {audit.map((entry) => (
                <li key={entry.id} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="font-medium">
                      {auditTargetLabel(entry, modeLabels)}
                    </span>
                    <span className="text-muted text-xs">
                      {dtf.format(new Date(entry.created_at))}
                      {entry.actor_email ? ` · ${entry.actor_email}` : ""}
                    </span>
                  </div>
                  <div className="text-muted space-y-0.5 text-xs">
                    {Object.entries(entry.metadata?.changes ?? {}).map(
                      ([field, c]) => (
                        <p key={field} className="break-all">
                          {changeLine(field, c)}
                        </p>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
