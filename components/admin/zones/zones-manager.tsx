"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Clock, Plus, Power, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/info-hint";
import { toast } from "@/components/ui/toast";
import { WILAYAS, getWilayaName } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";
import { SERVICE_LABELS, type ServiceKind } from "@/lib/zones/service-zones";
import {
  createZoneRule,
  deleteZoneRule,
  saveServiceDefaults,
  toggleZoneRule,
  updateZoneRulePriority,
  type ZoneRuleInput,
} from "@/app/admin/zones/actions";
import { ZoneMapEditor } from "./zone-map-editor";
import type { ServiceDefaultRow, ZoneRuleRow } from "./types";

const SERVICES: ServiceKind[] = ["express", "tour", "drive"];

const SCOPE_LABELS: Record<string, string> = {
  country: "Pays",
  wilaya: "Wilaya",
  commune: "Commune",
  radius: "Rayon",
  polygon: "Périmètre",
};
const DIRECTION_LABELS: Record<string, string> = {
  any: "Départ + arrivée",
  origin: "Départ",
  destination: "Arrivée",
};

function scopeSummary(r: ZoneRuleRow): string {
  switch (r.scope) {
    case "country":
      return `Pays ${r.country_code ?? "DZ"}`;
    case "wilaya":
      return `Wilaya ${r.wilaya_code} — ${getWilayaName(r.wilaya_code ?? "")}`;
    case "commune":
      return `${r.commune} (${getWilayaName(r.wilaya_code ?? "")})`;
    case "radius":
      return `${r.radius_km} km autour de ${r.center_lat?.toFixed(3)}, ${r.center_lng?.toFixed(3)}`;
    case "polygon":
      return `Périmètre · ${r.polygon?.length ?? 0} points`;
    default:
      return r.scope;
  }
}

export function ZonesManager({
  rules,
  defaults,
}: {
  rules: ZoneRuleRow[];
  defaults: ServiceDefaultRow[];
}) {
  const [active, setActive] = useState<ServiceKind>("express");
  const [creating, setCreating] = useState(false);

  const byService = useMemo(() => {
    const m: Record<ServiceKind, ZoneRuleRow[]> = {
      express: [],
      tour: [],
      drive: [],
    };
    for (const r of rules) m[r.service]?.push(r);
    return m;
  }, [rules]);

  const defaultFor = (s: ServiceKind): ServiceDefaultRow =>
    defaults.find((d) => d.service === s) ?? {
      service: s,
      default_allow: true,
      service_active: true,
      max_distance_km: null,
    };

  return (
    <div>
      {/* Onglets services */}
      <div className="border-border mb-4 flex gap-1 border-b">
        {SERVICES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActive(s)}
            className={
              "relative -mb-px border-b-2 px-3.5 py-2.5 text-sm font-bold transition " +
              (active === s
                ? "border-primary-600 text-primary-700"
                : "text-muted hover:text-foreground border-transparent")
            }
          >
            {SERVICE_LABELS[s]}
            <span className="text-subtle ml-1.5 text-[11px] font-semibold">
              {byService[s].length}
            </span>
          </button>
        ))}
      </div>

      <ServiceDefaultsPanel def={defaultFor(active)} />

      <div className="mt-5 mb-3 flex items-center justify-between">
        <h2 className="text-foreground text-sm font-bold">
          Règles · {SERVICE_LABELS[active]}
        </h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Ajouter une règle
        </Button>
      </div>

      <RulesList rules={byService[active]} />

      {creating && (
        <CreateRuleModal service={active} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

// ───────────────────────────── Défauts par service ─────────────────────────
function ServiceDefaultsPanel({ def }: { def: ServiceDefaultRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serviceActive, setServiceActive] = useState(def.service_active);
  const [defaultAllow, setDefaultAllow] = useState(def.default_allow);
  const [maxKm, setMaxKm] = useState(
    def.max_distance_km != null ? String(def.max_distance_km) : ""
  );

  const dirty =
    serviceActive !== def.service_active ||
    defaultAllow !== def.default_allow ||
    (maxKm === "" ? null : Number(maxKm)) !== def.max_distance_km;

  const save = () =>
    start(async () => {
      const r = await saveServiceDefaults({
        service: def.service,
        service_active: serviceActive,
        default_allow: defaultAllow,
        max_distance_km: maxKm === "" ? null : Number(maxKm),
      });
      if (r.error) toast.error(r.error);
      else router.refresh();
    });

  return (
    <div className="bg-surface border-border rounded-[14px] border p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Kill-switch */}
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={serviceActive}
            onChange={(e) => setServiceActive(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="text-foreground flex items-center gap-1 text-sm font-bold">
              Service actif
              <InfoHint
                title="Service actif"
                text="Interrupteur global du service. Décoché, le service est coupé partout, quelles que soient les règles de zone."
                example="Décocher « Drive » pendant une panne → plus aucune course possible, dans toute l'Algérie."
              />
            </span>
            <span className="text-muted text-xs">
              Décocher coupe entièrement le service (kill-switch).
            </span>
          </span>
        </label>

        {/* Couverture par défaut */}
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={defaultAllow}
            onChange={(e) => setDefaultAllow(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="text-foreground flex items-center gap-1 text-sm font-bold">
              Autorisé par défaut
              <InfoHint
                title="Autorisé par défaut"
                text="Comportement là où AUCUNE règle ne s'applique. Coché = ouvert partout sauf zones bloquées. Décoché = fermé partout sauf zones autorisées (mode liste blanche)."
                example="Décoché + une seule règle « Autoriser Béjaïa » → le service ne marche QUE dans Béjaïa."
              />
            </span>
            <span className="text-muted text-xs">
              Coché : partout sauf zones bloquées. Décoché : nulle part sauf
              zones autorisées (liste blanche).
            </span>
          </span>
        </label>

        {/* Distance max */}
        <div>
          <span className="text-foreground flex items-center gap-1 text-sm font-bold">
            Distance max (km)
            <InfoHint
              title="Distance max"
              text="Longueur maximale d'un trajet (Drive) ou d'une livraison, à vol d'oiseau. Vide = aucune limite. Recalculée côté serveur (infalsifiable)."
              example="30 → une course de 40 km est refusée avec « trajet trop long »."
            />
          </span>
          <Input
            type="number"
            inputMode="decimal"
            value={maxKm}
            onChange={(e) => setMaxKm(e.target.value)}
            placeholder="Aucune limite"
            className="mt-1 h-9"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {!serviceActive && (
          <span className="text-danger-700 inline-flex items-center gap-1 text-xs font-semibold">
            <Power className="size-3.5" /> Service coupé
          </span>
        )}
        {!defaultAllow && serviceActive && (
          <span className="text-warning-700 text-xs font-semibold">
            Mode liste blanche : seules les zones « autorisées » fonctionnent.
          </span>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── Liste de règles ─────────────────────────────
function RulesList({ rules }: { rules: ZoneRuleRow[] }) {
  if (!rules.length) {
    return (
      <div className="border-border text-muted rounded-[14px] border border-dashed p-6 text-center text-sm">
        Aucune règle. Le comportement par défaut du service s&apos;applique
        partout.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {rules.map((r) => (
        <RuleRow key={r.id} rule={r} />
      ))}
    </div>
  );
}

function RuleRow({ rule }: { rule: ZoneRuleRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [priority, setPriority] = useState(String(rule.priority));
  const isBlock = rule.mode === "block";

  const act = (fn: () => Promise<{ error?: string; ok?: boolean }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else router.refresh();
    });

  return (
    <div
      className={
        "bg-surface border-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border p-3 " +
        (rule.active ? "" : "opacity-55")
      }
    >
      <span
        className={
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold " +
          (isBlock
            ? "bg-danger-50 text-danger-700"
            : "bg-success-50 text-success-700")
        }
      >
        {isBlock ? (
          <Ban className="size-3" />
        ) : (
          <CheckCircle2 className="size-3" />
        )}
        {isBlock ? "Bloque" : "Autorise"}
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-foreground flex items-center gap-2 text-sm font-bold">
          {rule.label}
          {rule.coming_soon && (
            <span className="text-warning-700 inline-flex items-center gap-1 text-[11px] font-semibold">
              <Clock className="size-3" /> Bientôt
            </span>
          )}
        </div>
        <div className="text-muted text-xs">
          {SCOPE_LABELS[rule.scope]} · {scopeSummary(rule)}
          {rule.service === "drive" && (
            <> · {DIRECTION_LABELS[rule.direction]}</>
          )}
        </div>
      </div>

      {/* Priorité */}
      <label className="text-muted flex items-center gap-1 text-xs">
        Priorité
        <InfoHint
          title="Priorité"
          text="Si plusieurs règles visent le même endroit, la priorité la plus haute gagne (à égalité, la plus précise l'emporte)."
          example="Une règle « autoriser Akbou » en priorité 20 passe devant un « bloquer Béjaïa » en priorité 10."
          align="end"
        />
        <Input
          type="number"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          onBlur={() => {
            if (Number(priority) !== rule.priority)
              act(() => updateZoneRulePriority(rule.id, Number(priority)));
          }}
          className="h-8 w-16"
        />
      </label>

      {/* Activer/désactiver */}
      <button
        type="button"
        disabled={pending}
        onClick={() => act(() => toggleZoneRule(rule.id, !rule.active))}
        className={
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold " +
          (rule.active
            ? "border-success-200 text-success-700"
            : "border-border text-muted")
        }
      >
        <Power className="size-3.5" />
        {rule.active ? "Active" : "Inactive"}
      </button>

      {/* Supprimer */}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(`Supprimer la règle « ${rule.label} » ?`))
            act(() => deleteZoneRule(rule.id));
        }}
        className="text-danger-600 hover:bg-danger-50 inline-flex size-8 items-center justify-center rounded-full"
        aria-label="Supprimer"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

// ───────────────────────────── Création de règle ───────────────────────────
function CreateRuleModal({
  service,
  onClose,
}: {
  service: ServiceKind;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"allow" | "block">("block");
  const [scope, setScope] = useState<ZoneRuleInput["scope"]>("radius");
  const [direction, setDirection] = useState<ZoneRuleInput["direction"]>("any");
  const [priority, setPriority] = useState("10");
  const [comingSoon, setComingSoon] = useState(false);
  const [note, setNote] = useState("");

  const [wilayaCode, setWilayaCode] = useState("");
  const [commune, setCommune] = useState("");
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [radiusKm, setRadiusKm] = useState(5);
  const [polygon, setPolygon] = useState<[number, number][]>([]);

  const communes = wilayaCode ? getCommunes(wilayaCode) : [];

  const submit = () =>
    start(async () => {
      setErr(null);
      const payload: ZoneRuleInput = {
        label,
        service,
        mode,
        scope,
        direction: service === "drive" ? direction : "any",
        priority: Number(priority) || 0,
        coming_soon: comingSoon,
        note: note || null,
        country_code: scope === "country" ? "DZ" : null,
        wilaya_code:
          scope === "wilaya" || scope === "commune" ? wilayaCode : null,
        commune: scope === "commune" ? commune : null,
        center_lat: scope === "radius" ? (center?.lat ?? null) : null,
        center_lng: scope === "radius" ? (center?.lng ?? null) : null,
        radius_km: scope === "radius" ? radiusKm : null,
        polygon: scope === "polygon" ? polygon : null,
      };
      const r = await createZoneRule(payload);
      if (r.error) {
        setErr(r.error);
        return;
      }
      onClose();
      router.refresh();
    });

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(8,9,16,.55)" }}
      onClick={onClose}
    >
      <div
        className="bg-surface text-foreground max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-[20px] pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-[20px] sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border bg-surface sticky top-0 flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-extrabold">
            Nouvelle règle · {SERVICE_LABELS[service]}
          </h3>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X className="text-subtle size-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Nom */}
          <div>
            <label className="text-foreground mb-1 block text-xs font-bold">
              Nom de la règle
            </label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex. Centre-ville Béjaïa"
            />
          </div>

          {/* Mode allow/block */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("block")}
              className={
                "h-11 rounded-[12px] border text-sm font-bold " +
                (mode === "block"
                  ? "border-danger-300 bg-danger-50 text-danger-700"
                  : "border-border text-muted")
              }
            >
              Bloquer
            </button>
            <button
              type="button"
              onClick={() => setMode("allow")}
              className={
                "h-11 rounded-[12px] border text-sm font-bold " +
                (mode === "allow"
                  ? "border-success-300 bg-success-50 text-success-700"
                  : "border-border text-muted")
              }
            >
              Autoriser
            </button>
          </div>

          {/* Scope */}
          <div>
            <label className="text-foreground mb-1 flex items-center gap-1 text-xs font-bold">
              Périmètre
              <InfoHint
                title="Périmètre (forme visée)"
                text="La zone géographique de la règle. Pays / wilaya / commune = ciblage par nom. Rayon = un disque autour d'un point. Périmètre = une forme dessinée sur la carte."
                example="« Commune : Akbou » ne vise qu'Akbou ; « Rayon 5 km » vise tout ce qui est à moins de 5 km du centre choisi."
              />
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {(
                ["country", "wilaya", "commune", "radius", "polygon"] as const
              ).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={
                    "h-9 rounded-[10px] border text-[12px] font-semibold " +
                    (scope === s
                      ? "border-primary-600 bg-primary-50 text-primary-700"
                      : "border-border text-muted")
                  }
                >
                  {SCOPE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Scope-specific */}
          {scope === "country" && (
            <p className="text-muted bg-surface-2 rounded-[10px] p-3 text-xs">
              S&apos;applique à toute l&apos;Algérie (DZ) — utile comme
              kill-switch géographique combiné à la priorité.
            </p>
          )}

          {(scope === "wilaya" || scope === "commune") && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="text-foreground mb-1 block text-xs font-bold">
                  Wilaya
                </label>
                <select
                  value={wilayaCode}
                  onChange={(e) => {
                    setWilayaCode(e.target.value);
                    setCommune("");
                  }}
                  className="border-border bg-surface h-10 w-full rounded-[10px] border px-2 text-sm"
                >
                  <option value="">— Choisir —</option>
                  {WILAYAS.map((w) => (
                    <option key={w.code} value={w.code}>
                      {w.code} · {w.name}
                    </option>
                  ))}
                </select>
              </div>
              {scope === "commune" && (
                <div>
                  <label className="text-foreground mb-1 block text-xs font-bold">
                    Commune
                  </label>
                  {communes.length > 0 ? (
                    <select
                      value={commune}
                      onChange={(e) => setCommune(e.target.value)}
                      className="border-border bg-surface h-10 w-full rounded-[10px] border px-2 text-sm"
                      disabled={!wilayaCode}
                    >
                      <option value="">— Choisir —</option>
                      {communes.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={commune}
                      onChange={(e) => setCommune(e.target.value)}
                      placeholder="Nom de la commune"
                      disabled={!wilayaCode}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {scope === "radius" && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-foreground text-xs font-bold">
                  Rayon : {radiusKm} km
                </label>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className="w-1/2"
                />
              </div>
              <ZoneMapEditor
                mode="radius"
                radiusKm={radiusKm}
                onCenterChange={setCenter}
              />
              <p className="text-subtle mt-1 text-[11px]">
                Déplacez la carte : la croix = centre du disque.
              </p>
            </div>
          )}

          {scope === "polygon" && (
            <div>
              <ZoneMapEditor
                mode="polygon"
                radiusKm={radiusKm}
                onPolygonChange={setPolygon}
              />
              <p className="text-subtle mt-1 text-[11px]">
                Tapez sur la carte pour poser les sommets du périmètre.
              </p>
            </div>
          )}

          {/* Direction (Drive uniquement) */}
          {service === "drive" && (
            <div>
              <label className="text-foreground mb-1 flex items-center gap-1 text-xs font-bold">
                S&apos;applique au
                <InfoHint
                  title="Sens du trajet (Drive)"
                  text="À quelle extrémité de la course la règle s'applique : au départ, à l'arrivée, ou aux deux. Permet d'autoriser A→B sans autoriser B→A."
                  example="« Arrivée » + bloquer Akbou → on peut PARTIR d'Akbou, mais pas s'y faire déposer."
                />
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["any", "origin", "destination"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={
                      "h-9 rounded-[10px] border text-[12px] font-semibold " +
                      (direction === d
                        ? "border-primary-600 bg-primary-50 text-primary-700"
                        : "border-border text-muted")
                    }
                  >
                    {DIRECTION_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Priorité + coming soon */}
          <div className="grid grid-cols-2 items-end gap-3">
            <div>
              <label className="text-foreground mb-1 flex items-center gap-1 text-xs font-bold">
                Priorité
                <InfoHint
                  title="Priorité"
                  text="Quand plusieurs règles visent le même point, celle qui a la priorité la plus haute l'emporte. À priorité égale, la plus précise gagne (périmètre > rayon > commune > wilaya > pays)."
                  example="Bloquer la wilaya Béjaïa (priorité 10) + autoriser la commune Akbou (priorité 20) → tout Béjaïa est bloqué SAUF Akbou."
                  align="end"
                />
              </label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            {mode === "block" && (
              <label className="flex items-center gap-1.5 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={comingSoon}
                  onChange={(e) => setComingSoon(e.target.checked)}
                  className="size-4"
                />
                « Bientôt disponible »
                <InfoHint
                  title="« Bientôt disponible »"
                  text="Au lieu d'un simple refus, le client voit « Zone bientôt disponible » avec un bouton « Prévenez-moi ». Sert à mesurer la demande avant d'ouvrir une zone."
                  example="Akbou bloquée + « Bientôt » coché → le client peut laisser son numéro ; vous voyez la demande dans les stats."
                  align="end"
                />
              </label>
            )}
          </div>

          <div>
            <label className="text-foreground mb-1 block text-xs font-bold">
              Note (interne, optionnel)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Raison logistique…"
            />
          </div>

          {err && (
            <p className="text-danger-700 text-sm font-semibold">{err}</p>
          )}
        </div>

        <div className="border-border bg-surface sticky bottom-0 flex gap-2 border-t p-4">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Annuler
          </Button>
          <Button onClick={submit} disabled={pending} className="flex-1">
            {pending ? "Création…" : "Créer la règle"}
          </Button>
        </div>
      </div>
    </div>
  );
}
