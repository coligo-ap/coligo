"use client";

import { useState, useTransition } from "react";
import {
  Check,
  KeyRound,
  Loader2,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
  UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import {
  createStaffAdmin,
  updateAdminDomains,
  setAdminRole,
  toggleAdminActive,
  resetAdminPassword,
  deleteAdmin,
} from "@/app/admin/(plateforme)/admins/actions";

export type AdminRow = {
  email: string;
  label: string | null;
  role: "owner" | "staff";
  domains: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
};

/** Les 8 domaines + libellés courts (mêmes clés que le RBAC / moteur d'alertes). */
const SCOPES: { key: string; label: string }[] = [
  { key: "pilotage", label: "Pilotage" },
  { key: "commercants", label: "Commerçants" },
  { key: "livraison", label: "Livraison" },
  { key: "drive", label: "Coligo Drive" },
  { key: "finances", label: "Coligo Pay & Finances" },
  { key: "marketing", label: "Marketing" },
  { key: "confiance", label: "Confiance & Sécurité" },
  { key: "plateforme", label: "Plateforme" },
];

const labelOf = (k: string) => SCOPES.find((s) => s.key === k)?.label ?? k;

/** Mot de passe temporaire lisible (à communiquer puis à faire changer). */
function genPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const rnd = new Uint32Array(12);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < 12; i++) out += chars[rnd[i] % chars.length];
  return out;
}

export function AdminsManager({
  admins,
  selfEmail,
}: {
  admins: AdminRow[];
  selfEmail: string;
}) {
  return (
    <div className="space-y-6">
      <CreateForm />
      <div className="space-y-3">
        <h2 className="text-sm font-bold tracking-tight">
          Administrateurs ({admins.length})
        </h2>
        {admins.map((a) => (
          <AdminCard key={a.email} admin={a} selfEmail={selfEmail} />
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Création d'un sous-admin (staff)
// -----------------------------------------------------------------------------
function CreateForm() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const toggle = (k: string) =>
    setDomains((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));

  const submit = () => {
    start(async () => {
      const res = await createStaffAdmin({ email, label, password, domains });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Administrateur créé.");
      setEmail("");
      setLabel("");
      setPassword("");
      setDomains([]);
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold text-white transition-colors"
      >
        <Plus className="size-4" /> Nouvel administrateur
      </button>
    );
  }

  return (
    <div className="border-border bg-surface space-y-4 rounded-[16px] border p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <UserCog className="size-4" /> Nouvel administrateur (staff)
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted mb-1 block">Email professionnel</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="prenom@coligo.app"
            className="border-border w-full rounded-[10px] border px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted mb-1 block">Nom affiché (optionnel)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Responsable Livraison"
            className="border-border w-full rounded-[10px] border px-3 py-2"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-muted mb-1 block">Mot de passe temporaire</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="min. 8 caractères"
            className="border-border w-full rounded-[10px] border px-3 py-2 font-mono"
          />
          <button
            type="button"
            onClick={() => setPassword(genPassword())}
            className="border-border hover:bg-surface-2 shrink-0 rounded-[10px] border px-3 py-2 text-sm font-medium"
          >
            Générer
          </button>
        </div>
      </label>

      <div className="text-sm">
        <span className="text-muted mb-2 block">Domaines autorisés</span>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <DomainChip
              key={s.key}
              label={s.label}
              on={domains.includes(s.key)}
              onClick={() => toggle(s.key)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Créer l&apos;administrateur
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted hover:text-foreground px-3 py-2 text-sm"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Carte d'un admin existant
// -----------------------------------------------------------------------------
function AdminCard({
  admin,
  selfEmail,
}: {
  admin: AdminRow;
  selfEmail: string;
}) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(admin.domains);

  const isSelf = admin.email.toLowerCase() === selfEmail;
  const isOwner = admin.role === "owner";

  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else toast.success("Modification appliquée.");
    });

  const saveDomains = () => {
    if (draft.length === 0) {
      toast.error("Choisis au moins un domaine.");
      return;
    }
    run(() => updateAdminDomains(admin.email, draft));
    setEditing(false);
  };

  const doReset = async () => {
    const pwd = await prompt({
      title: "Réinitialiser le mot de passe",
      message: `Nouveau mot de passe pour ${admin.email} (min. 8 caractères).`,
      placeholder: "nouveau mot de passe",
    });
    if (!pwd) return;
    run(() => resetAdminPassword(admin.email, pwd));
  };

  const doDelete = async () => {
    const ok = await confirm({
      title: "Retirer cet administrateur ?",
      message: `${admin.email} perdra tout accès à l'espace admin. Son compte n'est pas supprimé.`,
      confirmLabel: "Retirer",
      danger: true,
    });
    if (ok) run(() => deleteAdmin(admin.email));
  };

  const doToggleRole = async () => {
    const next = isOwner ? "staff" : "owner";
    const ok = await confirm({
      title: isOwner ? "Rétrograder en staff ?" : "Promouvoir owner ?",
      message: isOwner
        ? "Cet owner deviendra un staff sans domaine (à ré-attribuer)."
        : "Ce staff aura un accès TOTAL à tous les domaines et pourra gérer les admins.",
      confirmLabel: isOwner ? "Rétrograder" : "Promouvoir",
      danger: !isOwner,
    });
    if (ok) run(() => setAdminRole(admin.email, next));
  };

  return (
    <div
      className={cn(
        "border-border bg-surface rounded-[16px] border p-4 shadow-sm",
        !admin.is_active && "opacity-60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{admin.label || admin.email}</span>
            {isOwner ? (
              <span className="bg-primary-100 text-primary-700 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                <ShieldCheck className="size-3" /> Owner
              </span>
            ) : (
              <span className="bg-surface-2 text-muted rounded-full px-2 py-0.5 text-xs font-semibold">
                Staff
              </span>
            )}
            {!admin.is_active && (
              <span className="bg-danger-50 text-danger-700 rounded-full px-2 py-0.5 text-xs font-semibold">
                Suspendu
              </span>
            )}
            {isSelf && (
              <span className="text-muted rounded-full px-2 py-0.5 text-xs">
                (vous)
              </span>
            )}
          </div>
          {admin.label && (
            <p className="text-muted mt-0.5 text-sm">{admin.email}</p>
          )}
        </div>
        {pending && <Loader2 className="text-muted size-4 animate-spin" />}
      </div>

      {/* Domaines */}
      <div className="mt-3">
        {isOwner ? (
          <p className="text-muted text-sm">Accès à tous les domaines.</p>
        ) : editing ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((s) => (
                <DomainChip
                  key={s.key}
                  label={s.label}
                  on={draft.includes(s.key)}
                  onClick={() =>
                    setDraft((d) =>
                      d.includes(s.key)
                        ? d.filter((x) => x !== s.key)
                        : [...d, s.key]
                    )
                  }
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveDomains}
                className="bg-primary-600 hover:bg-primary-700 rounded-[8px] px-3 py-1.5 text-sm font-semibold text-white"
              >
                Enregistrer
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(admin.domains);
                  setEditing(false);
                }}
                className="text-muted hover:text-foreground px-2 py-1.5 text-sm"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {admin.domains.length === 0 ? (
              <span className="text-danger-600 text-sm">Aucun domaine</span>
            ) : (
              admin.domains.map((d) => (
                <span
                  key={d}
                  className="bg-surface-2 rounded-full px-2 py-0.5 text-xs font-medium"
                >
                  {labelOf(d)}
                </span>
              ))
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-primary-700 ml-1 text-xs font-semibold hover:underline"
            >
              Modifier
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-border mt-3 flex flex-wrap gap-2 border-t pt-3">
        <ActionBtn icon={KeyRound} label="Mot de passe" onClick={doReset} />
        {!isSelf && (
          <ActionBtn
            icon={admin.is_active ? Pause : Play}
            label={admin.is_active ? "Suspendre" : "Réactiver"}
            onClick={() =>
              run(() => toggleAdminActive(admin.email, !admin.is_active))
            }
          />
        )}
        {!isSelf && (
          <ActionBtn
            icon={ShieldCheck}
            label={isOwner ? "Rétrograder" : "Promouvoir owner"}
            onClick={doToggleRole}
          />
        )}
        {!isSelf && (
          <ActionBtn icon={Trash2} label="Retirer" danger onClick={doDelete} />
        )}
      </div>
    </div>
  );
}

function DomainChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        on
          ? "border-primary-600 bg-primary-50 text-primary-700"
          : "border-border text-muted hover:bg-surface-2"
      )}
    >
      {label}
    </button>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-sm font-medium transition-colors",
        danger
          ? "text-danger-600 hover:bg-danger-50"
          : "text-muted hover:bg-surface-2 hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
