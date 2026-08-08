"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BellRing,
  Loader2,
  Pencil,
  Plus,
  Power,
  Send,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { AnnouncementPopup } from "@/components/shared/announcement-popup";
import {
  deleteAnnouncement,
  disableAnnouncement,
  publishAnnouncement,
  saveAnnouncement,
  sendAnnouncementPushNow,
  type AnnouncementInput,
} from "@/app/admin/marketing/annonces/actions";

// =============================================================================
// AnnouncementsManager — [Annonces] [Composer] (panneaux montés/hidden).
// Composer bilingue avec APERÇU EN DIRECT (le vrai composant AnnouncementPopup)
// + avertissement anti-spam (≥ 2 envois à la même audience en 24 h).
// =============================================================================

export type AdminAnnouncement = {
  id: string;
  status: "draft" | "published";
  title_fr: string;
  title_ar: string;
  body_fr: string;
  body_ar: string;
  image_url: string | null;
  audiences: string[];
  channel: "push" | "popup" | "both";
  popup_mode: "next_open" | "instant" | "route";
  route_prefix: string | null;
  blocking: boolean;
  buttons: {
    label_fr: string;
    label_ar: string;
    action:
      | "acknowledge"
      | "redirect_internal"
      | "redirect_external"
      | "dismiss";
    target: string | null;
  }[];
  starts_at: string;
  ends_at: string | null;
  push_sent_at: string | null;
  push_sent_count: number;
  disabled_at: string | null;
  created_at: string;
};

export type AnnouncementStatsMap = Record<
  string,
  {
    impressions: number;
    acked: number;
    dismissed: number;
    clicks_0: number;
    clicks_1: number;
  }
>;

const AUDIENCE_LABELS: Record<string, string> = {
  customer: "Clients",
  merchant: "Commerçants",
  driver: "Livreurs",
  chauffeur: "Chauffeurs",
};

const ROUTE_SUGGESTIONS = [
  "/",
  "/commandes",
  "/coligo-pay",
  "/drive",
  "/compte",
  "/dashboard",
  "/orders",
  "/catalog",
  "/finances",
  "/driver",
  "/chauffeur",
];

function derivedStatus(a: AdminAnnouncement): {
  label: string;
  cls: string;
} {
  if (a.disabled_at)
    return { label: "Désactivée", cls: "bg-rose-50 text-rose-700" };
  if (a.status === "draft")
    return { label: "Brouillon", cls: "bg-surface-2 text-muted" };
  const now = Date.now();
  if (new Date(a.starts_at).getTime() > now)
    return { label: "Programmée", cls: "bg-amber-50 text-amber-700" };
  if (a.ends_at && new Date(a.ends_at).getTime() < now)
    return { label: "Expirée", cls: "bg-surface-2 text-subtle" };
  return { label: "Active", cls: "bg-success-50 text-success-700" };
}

function emptyForm(): AnnouncementInput {
  return {
    id: null,
    title_fr: "",
    title_ar: "",
    body_fr: "",
    body_ar: "",
    image_url: null,
    audiences: ["customer"],
    channel: "both",
    popup_mode: "next_open",
    route_prefix: null,
    blocking: false,
    buttons: [],
    starts_at: null,
    ends_at: null,
  };
}

export function AnnouncementsManager({
  rows,
  stats,
  audiences24h,
}: {
  rows: AdminAnnouncement[];
  stats: AnnouncementStatsMap;
  audiences24h: Record<string, number>;
}) {
  const [tab, setTab] = useState<"liste" | "composer">(
    rows.length === 0 ? "composer" : "liste"
  );
  const [form, setForm] = useState<AnnouncementInput>(emptyForm());

  const edit = (a: AdminAnnouncement) => {
    setForm({
      id: a.id,
      title_fr: a.title_fr,
      title_ar: a.title_ar,
      body_fr: a.body_fr,
      body_ar: a.body_ar,
      image_url: a.image_url,
      audiences: a.audiences,
      channel: a.channel,
      popup_mode: a.popup_mode,
      route_prefix: a.route_prefix,
      blocking: a.blocking,
      buttons: a.buttons,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
    });
    setTab("composer");
  };

  return (
    <div>
      <div className="border-border bg-surface-2 rounded-card mb-4 flex w-fit gap-1 border p-1">
        {(
          [
            ["liste", `Annonces (${rows.length})`],
            ["composer", form.id ? "Édition" : "Composer"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "rounded-control px-3 py-1.5 text-sm font-bold transition-colors",
              tab === key
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={cn(tab !== "liste" && "hidden")}>
        <ListPanel
          rows={rows}
          stats={stats}
          onEdit={edit}
          onNew={() => {
            setForm(emptyForm());
            setTab("composer");
          }}
        />
      </div>
      <div className={cn(tab !== "composer" && "hidden")}>
        <ComposerPanel
          form={form}
          setForm={setForm}
          audiences24h={audiences24h}
          onSaved={() => setTab("liste")}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────── Liste ─────────────────────────────── */

function ListPanel({
  rows,
  stats,
  onEdit,
  onNew,
}: {
  rows: AdminAnnouncement[];
  stats: AnnouncementStatsMap;
  onEdit: (a: AdminAnnouncement) => void;
  onNew: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="border-border bg-surface rounded-lg border p-6 text-center">
        <span className="bg-primary-50 text-primary-600 mx-auto grid size-12 place-items-center rounded-2xl">
          <BellRing className="size-6" />
        </span>
        <p className="text-foreground mt-3 text-sm font-extrabold">
          Aucune annonce
        </p>
        <button
          type="button"
          onClick={onNew}
          className="bg-primary-600 hover:bg-primary-700 rounded-control-lg mt-3 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-extrabold text-white"
        >
          <Plus className="size-4" />
          Composer la première
        </button>
      </div>
    );
  }
  return (
    <div className="border-border bg-surface divide-border divide-y overflow-hidden rounded-lg border">
      {rows.map((a) => (
        <AnnouncementRow key={a.id} a={a} s={stats[a.id]} onEdit={onEdit} />
      ))}
    </div>
  );
}

function AnnouncementRow({
  a,
  s,
  onEdit,
}: {
  a: AdminAnnouncement;
  s?: AnnouncementStatsMap[string];
  onEdit: (a: AdminAnnouncement) => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  // État LOCAL par ligne (règle CLAUDE.md).
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const st = derivedStatus(a);
  const ackPct =
    s && s.impressions > 0 ? Math.round((s.acked / s.impressions) * 100) : 0;
  const isActive = st.label === "Active" || st.label === "Programmée";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action impossible.");
      else router.refresh();
    });
  };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-sm font-extrabold">
            {a.blocking && (
              <AlertTriangle className="me-1 inline size-3.5 text-amber-600" />
            )}
            {a.title_fr}
          </span>
          <span className="text-muted text-caption block font-semibold">
            {a.audiences.map((x) => AUDIENCE_LABELS[x] ?? x).join(" · ")} ·{" "}
            {a.channel === "both"
              ? "push + pop-up"
              : a.channel === "push"
                ? "push"
                : "pop-up"}
            {a.popup_mode === "instant" && " · instantanée"}
            {a.popup_mode === "route" && ` · page ${a.route_prefix}`}
          </span>
        </span>
        <span
          className={cn(
            "text-caption shrink-0 rounded-full px-2.5 py-1 font-extrabold",
            st.cls
          )}
        >
          {st.label}
        </span>
      </div>

      <p className="text-muted text-caption mt-1.5 font-bold tabular-nums">
        {a.push_sent_at ? `${a.push_sent_count} push` : "push —"} ·{" "}
        {s?.impressions ?? 0} vues · {ackPct} % acquittées
        {a.buttons.length > 0 &&
          ` · clics ${s?.clicks_0 ?? 0}${a.buttons.length > 1 ? ` / ${s?.clicks_1 ?? 0}` : ""}`}
      </p>

      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {a.status === "draft" && (
          <RowBtn
            busy={busy}
            icon={Send}
            onClick={() =>
              run(async () => {
                const ok = await confirm({
                  title: a.blocking
                    ? "Publier cette annonce BLOQUANTE ?"
                    : "Publier cette annonce ?",
                  message: a.blocking
                    ? "Les utilisateurs ciblés DEVRONT interagir pour continuer — réservée aux annonces critiques."
                    : `Diffusion vers : ${a.audiences.map((x) => AUDIENCE_LABELS[x]).join(", ")}.`,
                  confirmLabel: "Publier",
                });
                if (!ok) return { ok: true };
                return publishAnnouncement(a.id);
              })
            }
          >
            Publier
          </RowBtn>
        )}
        {a.status === "published" &&
          !a.push_sent_at &&
          !a.disabled_at &&
          a.channel !== "popup" &&
          new Date(a.starts_at) <= new Date() && (
            <RowBtn
              busy={busy}
              icon={Send}
              onClick={() => run(() => sendAnnouncementPushNow(a.id))}
            >
              Envoyer la push maintenant
            </RowBtn>
          )}
        {isActive && a.status === "published" && !a.disabled_at && (
          <RowBtn
            busy={busy}
            icon={Power}
            danger
            onClick={() =>
              run(async () => {
                const ok = await confirm({
                  title: "Désactiver cette annonce ?",
                  message:
                    "Elle disparaît immédiatement, y compris des apps ouvertes.",
                  confirmLabel: "Désactiver",
                  danger: true,
                });
                if (!ok) return { ok: true };
                return disableAnnouncement(a.id);
              })
            }
          >
            Désactiver
          </RowBtn>
        )}
        <RowBtn busy={busy} icon={Pencil} onClick={() => onEdit(a)}>
          Modifier
        </RowBtn>
        {a.status === "draft" && (
          <RowBtn
            busy={busy}
            icon={Trash2}
            danger
            onClick={() =>
              run(async () => {
                const ok = await confirm({
                  title: "Supprimer ce brouillon ?",
                  danger: true,
                  confirmLabel: "Supprimer",
                });
                if (!ok) return { ok: true };
                return deleteAnnouncement(a.id);
              })
            }
          >
            Supprimer
          </RowBtn>
        )}
      </div>
    </div>
  );
}

function RowBtn({
  busy,
  icon: Icon,
  danger,
  onClick,
  children,
}: {
  busy: boolean;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "rounded-control inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-extrabold transition-colors disabled:opacity-60",
        danger
          ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
          : "bg-surface-2 text-foreground hover:bg-surface-3"
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {children}
    </button>
  );
}

/* ─────────────────────────────── Composer ─────────────────────────────── */

function ComposerPanel({
  form,
  setForm,
  audiences24h,
  onSaved,
}: {
  form: AnnouncementInput;
  setForm: React.Dispatch<React.SetStateAction<AnnouncementInput>>;
  audiences24h: Record<string, number>;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewLocale, setPreviewLocale] = useState<"fr" | "ar">("fr");

  const spamWarn = useMemo(
    () => form.audiences.filter((a) => (audiences24h[a] ?? 0) >= 2),
    [form.audiences, audiences24h]
  );

  const set = <K extends keyof AnnouncementInput>(
    key: K,
    value: AnnouncementInput[K]
  ) => setForm((f) => ({ ...f, [key]: value }));

  const save = (thenPublish: boolean) => {
    setMsg(null);
    startTransition(async () => {
      const res = await saveAnnouncement(form);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      if (thenPublish && res.id) {
        const pub = await publishAnnouncement(res.id);
        if (!pub.ok) {
          setMsg({ ok: false, text: pub.error });
          return;
        }
        setMsg({ ok: true, text: "Annonce publiée." });
      } else {
        setMsg({ ok: true, text: "Brouillon enregistré." });
      }
      router.refresh();
      onSaved();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* ── FORMULAIRE ── */}
      <div className="border-border bg-surface space-y-4 rounded-lg border p-4">
        {spamWarn.length > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {spamWarn.map((a) => AUDIENCE_LABELS[a]).join(", ")} :{" "}
            {
              "déjà ≥ 2 annonces sur les dernières 24 h — attention au sur-envoi."
            }
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Titre (FR)">
            <input
              value={form.title_fr}
              onChange={(e) => set("title_fr", e.target.value)}
              maxLength={80}
              className={inputCls}
            />
          </Field>
          <Field label="Titre (AR)">
            <input
              dir="rtl"
              value={form.title_ar}
              onChange={(e) => set("title_ar", e.target.value)}
              maxLength={80}
              className={inputCls}
            />
          </Field>
          <Field label="Message (FR)">
            <textarea
              value={form.body_fr}
              onChange={(e) => set("body_fr", e.target.value)}
              rows={3}
              maxLength={400}
              className={cn(inputCls, "resize-none")}
            />
          </Field>
          <Field label="Message (AR)">
            <textarea
              dir="rtl"
              value={form.body_ar}
              onChange={(e) => set("body_ar", e.target.value)}
              rows={3}
              maxLength={400}
              className={cn(inputCls, "resize-none")}
            />
          </Field>
        </div>

        <Field label="Image (URL, optionnelle)">
          <input
            value={form.image_url ?? ""}
            onChange={(e) => set("image_url", e.target.value || null)}
            placeholder="https://…"
            className={inputCls}
          />
        </Field>

        <Field label="Audience">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(AUDIENCE_LABELS).map(([key, label]) => {
              const on = form.audiences.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    set(
                      "audiences",
                      on
                        ? form.audiences.filter((a) => a !== key)
                        : [...form.audiences, key]
                    )
                  }
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-extrabold transition-colors",
                    on
                      ? "bg-primary-600 text-white"
                      : "bg-surface-2 text-muted hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Canal">
            <select
              value={form.channel}
              onChange={(e) =>
                set("channel", e.target.value as AnnouncementInput["channel"])
              }
              className={inputCls}
            >
              <option value="both">Push + pop-up</option>
              <option value="push">Push seule</option>
              <option value="popup">Pop-up seule</option>
            </select>
          </Field>
          <Field label="Affichage de la pop-up">
            <select
              value={form.popup_mode}
              onChange={(e) =>
                set(
                  "popup_mode",
                  e.target.value as AnnouncementInput["popup_mode"]
                )
              }
              disabled={form.channel === "push"}
              className={inputCls}
            >
              <option value="next_open">À la prochaine ouverture</option>
              <option value="instant">Instantané (app ouverte)</option>
              <option value="route">Sur une page précise</option>
            </select>
          </Field>
        </div>

        {form.popup_mode === "route" && (
          <Field label="Préfixe de route (ex : /dashboard)">
            <input
              value={form.route_prefix ?? ""}
              onChange={(e) => set("route_prefix", e.target.value || null)}
              list="ann-routes"
              placeholder="/dashboard"
              className={inputCls}
            />
            <datalist id="ann-routes">
              {ROUTE_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
        )}

        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="text-foreground block text-sm font-extrabold">
              Bloquante
            </span>
            <span className="text-muted block text-xs">
              L&apos;utilisateur DOIT interagir — réservée au critique
              (maintenance, mise à jour, alerte). Impose au moins un bouton.
            </span>
          </span>
          <input
            type="checkbox"
            checked={form.blocking}
            onChange={(e) => set("blocking", e.target.checked)}
            className="accent-primary-600 size-5"
          />
        </label>

        <ButtonsEditor form={form} setForm={setForm} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Envoi (vide = immédiat)">
            <input
              type="datetime-local"
              value={form.starts_at ? form.starts_at.slice(0, 16) : ""}
              onChange={(e) =>
                set(
                  "starts_at",
                  e.target.value ? new Date(e.target.value).toISOString() : null
                )
              }
              className={inputCls}
            />
          </Field>
          <Field label="Expiration (optionnelle)">
            <input
              type="datetime-local"
              value={form.ends_at ? form.ends_at.slice(0, 16) : ""}
              onChange={(e) =>
                set(
                  "ends_at",
                  e.target.value ? new Date(e.target.value).toISOString() : null
                )
              }
              className={inputCls}
            />
          </Field>
        </div>

        {msg && (
          <p
            className={cn(
              "text-sm font-medium",
              msg.ok ? "text-success-700" : "text-rose-600"
            )}
          >
            {msg.text}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => save(false)}
            className="border-border text-foreground rounded-control-lg inline-flex items-center gap-2 border-2 px-4 py-2.5 text-sm font-extrabold disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Enregistrer le brouillon
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => save(true)}
            className="bg-primary-600 hover:bg-primary-700 rounded-control-lg inline-flex items-center gap-2 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Publier
          </button>
        </div>
      </div>

      {/* ── APERÇU EN DIRECT (le VRAI composant) ── */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-muted text-caption font-extrabold tracking-wide uppercase">
            Aperçu en direct
          </p>
          <div className="bg-surface-2 text-caption flex gap-0.5 rounded-full p-0.5 font-extrabold">
            {(["fr", "ar"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setPreviewLocale(l)}
                className={cn(
                  "rounded-full px-2.5 py-1 transition-colors",
                  previewLocale === l
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted"
                )}
              >
                {l === "fr" ? "FR" : "ع"}
              </button>
            ))}
          </div>
        </div>
        <div className="border-border bg-surface-2 rounded-panel-lg border p-3">
          <AnnouncementPopup
            preview
            locale={previewLocale}
            announcement={{
              id: "preview",
              title_fr: form.title_fr || "Titre de l'annonce",
              title_ar: form.title_ar || "عنوان الإعلان",
              body_fr:
                form.body_fr || "Le message tel que le verra l'utilisateur.",
              body_ar: form.body_ar || "الرسالة كما سيراها المستخدم.",
              image_url: form.image_url ?? null,
              blocking: form.blocking,
              buttons: form.buttons.map((b) => ({
                label_fr: b.label_fr,
                label_ar: b.label_ar || null,
                action: b.action,
                target: b.target ?? null,
              })),
            }}
            onAction={() => undefined}
          />
        </div>
      </div>
    </div>
  );
}

function ButtonsEditor({
  form,
  setForm,
}: {
  form: AnnouncementInput;
  setForm: React.Dispatch<React.SetStateAction<AnnouncementInput>>;
}) {
  const update = (
    i: number,
    patch: Partial<AnnouncementInput["buttons"][number]>
  ) =>
    setForm((f) => ({
      ...f,
      buttons: f.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    }));

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-muted text-caption font-extrabold tracking-wide uppercase">
          Boutons ({form.buttons.length}/2)
        </p>
        {form.buttons.length < 2 && (
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({
                ...f,
                buttons: [
                  ...f.buttons,
                  {
                    label_fr: "J'ai compris",
                    label_ar: "فهمت",
                    action: "acknowledge",
                    target: null,
                  },
                ],
              }))
            }
            className="bg-surface-2 text-foreground hover:bg-surface-3 rounded-chip inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-extrabold"
          >
            <Plus className="size-3.5" />
            Ajouter
          </button>
        )}
      </div>
      {form.buttons.map((b, i) => (
        <div
          key={i}
          className="border-border bg-surface-2 mb-2 rounded-md border p-2.5"
        >
          <div className="grid grid-cols-2 gap-2">
            <input
              value={b.label_fr}
              onChange={(e) => update(i, { label_fr: e.target.value })}
              placeholder="Libellé FR"
              maxLength={40}
              className={inputCls}
            />
            <input
              dir="rtl"
              value={b.label_ar}
              onChange={(e) => update(i, { label_ar: e.target.value })}
              placeholder="Libellé AR"
              maxLength={40}
              className={inputCls}
            />
            <select
              value={b.action}
              onChange={(e) =>
                update(i, {
                  action: e.target
                    .value as AnnouncementInput["buttons"][number]["action"],
                })
              }
              className={inputCls}
            >
              <option value="acknowledge">J&apos;ai compris (accusé)</option>
              <option value="redirect_internal">
                Ouvrir un écran de l&apos;app
              </option>
              <option value="redirect_external">Ouvrir une URL externe</option>
              <option value="dismiss">Fermer sans accusé</option>
            </select>
            {b.action === "redirect_internal" ||
            b.action === "redirect_external" ? (
              <input
                value={b.target ?? ""}
                onChange={(e) => update(i, { target: e.target.value || null })}
                placeholder={
                  b.action === "redirect_internal" ? "/coligo-pay" : "https://…"
                }
                className={inputCls}
              />
            ) : (
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    buttons: f.buttons.filter((_, j) => j !== i),
                  }))
                }
                className="text-subtle justify-self-end text-xs font-bold hover:text-rose-600"
              >
                Retirer
              </button>
            )}
          </div>
          {(b.action === "redirect_internal" ||
            b.action === "redirect_external") && (
            <button
              type="button"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  buttons: f.buttons.filter((_, j) => j !== i),
                }))
              }
              className="text-subtle mt-1.5 text-xs font-bold hover:text-rose-600"
            >
              Retirer ce bouton
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const inputCls =
  "border-border bg-surface text-foreground w-full rounded-control border px-3 py-2 text-sm outline-none focus:border-[color:var(--color-primary-500)]";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-muted mb-1 block text-xs font-bold">{label}</span>
      {children}
    </label>
  );
}
