"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { ImagePlus, RotateCcw } from "lucide-react";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { resizeImage } from "@/components/admin/bannieres/banners-shared";
import {
  DEFAULT_RECRUTE_ROLES,
  RECRUTE_DESIGNS,
  type RecruteDesignKey,
} from "@/lib/config/recrute-content";
import {
  setRecrutePage,
  setRecruteRole,
  uploadRecruteImage,
} from "@/app/admin/marketing/recrutement/actions";
import type { RecruteRoleDraft } from "@/lib/data/recrute-content";

/**
 * Pilotage de la page publique /recrute : habillage du héros et contenu des
 * 4 cartes métier.
 *
 * Un champ LAISSÉ VIDE n'efface rien : il fait revenir la valeur livrée avec
 * le code (affichée en indication sous le champ). Impossible, donc, de casser
 * la page en vidant un champ par mégarde.
 *
 * Les kill-switch `recruit_*` (masquer un métier) restent dans
 * Contrôle des services — ici on habille, on ne coupe pas.
 */
export function RecruteManager({
  initialDesign,
  initialHeroTitle,
  initialHeroSubtitle,
  initialRoles,
}: {
  initialDesign: RecruteDesignKey;
  initialHeroTitle: string;
  initialHeroSubtitle: string;
  initialRoles: RecruteRoleDraft[];
}) {
  return (
    <div className="space-y-6">
      <HeroCard
        initialDesign={initialDesign}
        initialTitle={initialHeroTitle}
        initialSubtitle={initialHeroSubtitle}
      />
      {initialRoles.map((r) => (
        <RoleCard key={r.key} draft={r} />
      ))}
    </div>
  );
}

/* ─────────────────────────── Héros ─────────────────────────── */

function HeroCard({
  initialDesign,
  initialTitle,
  initialSubtitle,
}: {
  initialDesign: RecruteDesignKey;
  initialTitle: string;
  initialSubtitle: string;
}) {
  const [design, setDesign] = useState<RecruteDesignKey>(initialDesign);
  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState(initialSubtitle);
  const [pending, start] = useTransition();
  const [note, setNote] = useActionNote();

  const save = () =>
    start(async () => {
      const res = await setRecrutePage({
        design,
        heroTitle: title,
        heroSubtitle: subtitle,
      });
      if (res.error) setNote({ ok: false, text: res.error });
      else
        setNote({
          ok: true,
          text: "Habillage enregistré — la page est à jour.",
        });
    });

  return (
    <section className="border-border bg-surface rounded-lg border p-4">
      <h2 className="text-title-sm font-bold">Habillage du héros</h2>
      <p className="text-caption text-muted mt-0.5">
        Le bandeau du haut de la page. Le violet Coligo est le choix par défaut.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(
          Object.entries(RECRUTE_DESIGNS) as [
            RecruteDesignKey,
            (typeof RECRUTE_DESIGNS)[RecruteDesignKey],
          ][]
        ).map(([key, d]) => {
          const on = key === design;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDesign(key)}
              aria-pressed={on}
              className={`rounded-control overflow-hidden border p-0 text-start transition-colors ${
                on ? "border-primary-600" : "border-border hover:bg-surface-2"
              }`}
            >
              {/* Aperçu RÉEL du dégradé appliqué à la page. */}
              <span
                aria-hidden
                className="block h-12 w-full"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${d.g1}, ${d.g2} 52%, ${d.g3})`,
                }}
              />
              <span className="block px-2.5 py-1.5">
                <span className="text-body-sm block font-bold">{d.label}</span>
                <span className="text-caption text-muted block leading-snug">
                  {d.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-3">
        <Field
          label="Titre"
          htmlFor="rc-title"
          hint="Laisser vide pour garder le titre livré avec l'application."
        >
          <Input
            id="rc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Travaillez avec Coligo. Gagnez à votre rythme."
          />
        </Field>
        <Field
          label="Sous-titre"
          htmlFor="rc-sub"
          hint="Laisser vide pour garder le texte livré avec l'application."
        >
          <Input
            id="rc-sub"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Commerçant, livreur, chauffeur ou agent : choisissez votre métier…"
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={pending} size="sm">
          {pending ? "Enregistrement…" : "Enregistrer l'habillage"}
        </Button>
        <ActionNote note={note} />
      </div>
    </section>
  );
}

/* ─────────────────────────── Carte métier ─────────────────────────── */

function RoleCard({ draft }: { draft: RecruteRoleDraft }) {
  const base = DEFAULT_RECRUTE_ROLES.find((r) => r.key === draft.key)!;
  const [imgUrl, setImgUrl] = useState(draft.imgUrl);
  const [imgAlt, setImgAlt] = useState(draft.imgAlt);
  const [title, setTitle] = useState(draft.title);
  const [tagline, setTagline] = useState(draft.tagline);
  const [highlight, setHighlight] = useState(draft.highlight);
  const [cta, setCta] = useState(draft.cta);
  const [perks, setPerks] = useState<string[]>(
    draft.perks.length ? draft.perks : ["", "", ""]
  );
  // État LOCAL à cette carte : enregistrer un métier ne fige jamais les autres.
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useActionNote();

  const shown = imgUrl || base.img;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      // Redimensionné AVANT envoi : une photo d'appareil ferait plusieurs Mo.
      const blob = await resizeImage(file);
      const fd = new FormData();
      fd.append("file", blob, "recrute.jpg");
      const res = await uploadRecruteImage(fd);
      if (res.error) setNote({ ok: false, text: res.error });
      else if (res.url) {
        setImgUrl(res.url);
        setNote({ ok: true, text: "Photo importée — pense à enregistrer." });
      }
    } finally {
      setUploading(false);
    }
  };

  const save = () =>
    start(async () => {
      const res = await setRecruteRole({
        key: draft.key as never,
        imgUrl: imgUrl || null,
        imgAlt,
        title,
        tagline,
        highlight,
        cta,
        perks,
      });
      if (res.error) setNote({ ok: false, text: res.error });
      else
        setNote({ ok: true, text: "Carte enregistrée — la page est à jour." });
    });

  return (
    <section className="border-border bg-surface rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-title-sm font-bold">{base.title}</h2>
        <code className="text-nano-lg text-muted font-mono">{draft.key}</code>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* Aperçu au ratio EXACT de la page publique (pas de mauvaise surprise). */}
        <div>
          <div className="border-border bg-surface-2 rounded-control relative aspect-[2/1] w-full overflow-hidden border">
            <Image
              src={shown}
              alt=""
              fill
              sizes="220px"
              className="object-cover"
              unoptimized
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void onPick(e.target.files?.[0])}
              />
              <span className="border-border hover:bg-surface-2 rounded-control text-label-lg inline-flex h-9 items-center gap-1.5 border px-3 font-semibold">
                <ImagePlus className="size-4" />
                {uploading ? "Import…" : "Changer la photo"}
              </span>
            </label>
            {imgUrl && (
              <button
                type="button"
                onClick={() => setImgUrl("")}
                className="border-border hover:bg-surface-2 rounded-control text-label-lg inline-flex h-9 items-center gap-1.5 border px-3 font-semibold"
              >
                <RotateCcw className="size-4" />
                Visuel d&apos;origine
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Titre" htmlFor={`t-${draft.key}`} hint={base.title}>
              <Input
                id={`t-${draft.key}`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={base.title}
              />
            </Field>
            <Field
              label="Argument mis en avant"
              htmlFor={`h-${draft.key}`}
              hint={base.highlight}
            >
              <Input
                id={`h-${draft.key}`}
                value={highlight}
                onChange={(e) => setHighlight(e.target.value)}
                placeholder={base.highlight}
              />
            </Field>
          </div>
          <Field
            label="Accroche"
            htmlFor={`g-${draft.key}`}
            hint={base.tagline}
          >
            <Input
              id={`g-${draft.key}`}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder={base.tagline}
            />
          </Field>

          <div className="space-y-1.5">
            <p className="text-label text-foreground font-semibold">
              Avantages (3 lignes)
            </p>
            {perks.map((p, i) => (
              <Input
                key={i}
                value={p}
                onChange={(e) =>
                  setPerks((prev) =>
                    prev.map((v, j) => (j === i ? e.target.value : v))
                  )
                }
                placeholder={base.perks[i] ?? "Avantage"}
                aria-label={`Avantage ${i + 1}`}
              />
            ))}
            <p className="text-caption text-muted">
              Tout laisser vide remet les avantages livrés avec
              l&apos;application.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bouton" htmlFor={`c-${draft.key}`} hint={base.cta}>
              <Input
                id={`c-${draft.key}`}
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder={base.cta}
              />
            </Field>
            <Field
              label="Description de la photo"
              htmlFor={`a-${draft.key}`}
              hint="Lue par les lecteurs d'écran et affichée si la photo ne charge pas."
            >
              <Input
                id={`a-${draft.key}`}
                value={imgAlt}
                onChange={(e) => setImgAlt(e.target.value)}
                placeholder={base.imgAlt}
              />
            </Field>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={pending} size="sm">
              {pending ? "Enregistrement…" : "Enregistrer cette carte"}
            </Button>
            <ActionNote note={note} />
          </div>
        </div>
      </div>
    </section>
  );
}
