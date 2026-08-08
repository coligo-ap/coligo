"use client";

import * as React from "react";
import { Bike, Inbox, Moon, Package, Save, Sun, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, fieldControlProps } from "@/components/ui/field";
import { Toggle, ToggleRow } from "@/components/ui/toggle";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Sheet } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { DsCase, DsDemo, DsSection, DsSwatch } from "./ds-primitives";
import { cn } from "@/lib/utils";

const SECTIONS = [
  ["palette", "Palette"],
  ["typo", "Typographie"],
  ["formes", "Rayons & élévation"],
  ["mouvement", "Mouvement"],
  ["boutons", "Boutons"],
  ["badges", "Badges"],
  ["formulaires", "Formulaires"],
  ["navigation", "Navigation & réglages"],
  ["feedback", "États & retours"],
  ["surfaces", "Surfaces"],
] as const;

export function DesignSystemView() {
  const [dark, setDark] = React.useState(false);
  const [rtl, setRtl] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [toggleOn, setToggleOn] = React.useState(true);
  const [tab, setTab] = React.useState<"jour" | "semaine" | "mois">("semaine");

  // Le mode sombre est piloté par `.theme-dark` sur <html> (cookie en temps
  // normal) : on le pose ici sans toucher au cookie, pour ne pas changer la
  // préférence réelle de la personne qui consulte la vitrine.
  React.useEffect(() => {
    const el = document.documentElement;
    const had = el.classList.contains("theme-dark");
    el.classList.toggle("theme-dark", dark);
    return () => {
      el.classList.toggle("theme-dark", had);
    };
  }, [dark]);

  return (
    <div className="bg-background text-foreground min-h-dvh">
      {/* Barre de contrôle : thème et direction, les deux axes qu'il faut
          pouvoir vérifier d'un coup d'œil sur CHAQUE composant. */}
      <header className="border-border bg-surface/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-6 py-3">
          <div className="me-auto">
            <h1 className="text-title-lg font-extrabold">Design System</h1>
            <p className="text-caption text-muted">
              Tokens : <code className="font-mono">app/design-tokens.css</code>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDark((v) => !v)}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {dark ? "Clair" : "Sombre"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRtl((v) => !v)}>
            {rtl ? "LTR" : "RTL (arabe)"}
          </Button>
        </div>
        <nav className="scrollbar-hide mx-auto flex max-w-5xl gap-1 overflow-x-auto px-6 pb-2">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-chip text-caption text-muted hover:bg-surface-2 hover:text-foreground shrink-0 px-2.5 py-1 font-semibold"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      {/*
       * Zone d'aperçu. `data-space="client"` est requis : les remaps du mode
       * sombre sont scopés à cet espace — sans lui, basculer en sombre
       * n'affecterait que le fond, pas les composants.
       */}
      <main
        dir={rtl ? "rtl" : "ltr"}
        data-space="client"
        className="mx-auto max-w-5xl space-y-8 px-6 pb-24"
      >
        <DsSection
          id="palette"
          title="Palette"
          intro="Chaque pastille porte le nom de son token et sa valeur calculée dans le thème actif. Les tokens de MARQUE ne bougent jamais ; les tokens SÉMANTIQUES (surfaces, textes, bordures) changent de valeur entre clair et sombre sans changer de nom — c'est ce qui permet d'écrire un composant une seule fois."
        >
          {/*
           * Les classes sont écrites EN TOUTES LETTRES : Tailwind détecte les
           * utilitaires en lisant le source, il ne peut rien faire d'un
           * `bg-primary-${n}` construit à l'exécution.
           */}
          <DsDemo title="Marque — violet primaire" source="--color-primary-*">
            {(
              [
                ["--color-primary-50", "bg-primary-50"],
                ["--color-primary-100", "bg-primary-100"],
                ["--color-primary-200", "bg-primary-200"],
                ["--color-primary-300", "bg-primary-300"],
                ["--color-primary-400", "bg-primary-400"],
                ["--color-primary-500", "bg-primary-500"],
                ["--color-primary-600", "bg-primary-600"],
                ["--color-primary-700", "bg-primary-700"],
                ["--color-primary-800", "bg-primary-800"],
                ["--color-primary-900", "bg-primary-900"],
              ] as const
            ).map(([token, cls]) => (
              <DsSwatch key={token} token={token} className={cls} />
            ))}
          </DsDemo>
          <DsDemo
            title="Marque — rose accent (PROMOTIONS uniquement)"
            source="--color-accent-*"
            note="Réservé aux réductions, codes promo et prix barrés. L'utiliser ailleurs affaiblit le signal commercial."
          >
            {(
              [
                ["--color-accent-50", "bg-accent-50"],
                ["--color-accent-100", "bg-accent-100"],
                ["--color-accent-200", "bg-accent-200"],
                ["--color-accent-300", "bg-accent-300"],
                ["--color-accent-400", "bg-accent-400"],
                ["--color-accent-500", "bg-accent-500"],
                ["--color-accent-600", "bg-accent-600"],
                ["--color-accent-700", "bg-accent-700"],
              ] as const
            ).map(([token, cls]) => (
              <DsSwatch key={token} token={token} className={cls} />
            ))}
          </DsDemo>
          <DsDemo
            title="États sémantiques"
            source="--color-{success,warning,danger,info}-*"
          >
            {(
              [
                ["--color-success-50", "bg-success-50"],
                ["--color-success-100", "bg-success-100"],
                ["--color-success-500", "bg-success-500"],
                ["--color-success-600", "bg-success-600"],
                ["--color-success-700", "bg-success-700"],
                ["--color-warning-50", "bg-warning-50"],
                ["--color-warning-100", "bg-warning-100"],
                ["--color-warning-500", "bg-warning-500"],
                ["--color-warning-600", "bg-warning-600"],
                ["--color-warning-700", "bg-warning-700"],
                ["--color-danger-50", "bg-danger-50"],
                ["--color-danger-100", "bg-danger-100"],
                ["--color-danger-500", "bg-danger-500"],
                ["--color-danger-600", "bg-danger-600"],
                ["--color-danger-700", "bg-danger-700"],
                ["--color-info-50", "bg-info-50"],
                ["--color-info-100", "bg-info-100"],
                ["--color-info-500", "bg-info-500"],
                ["--color-info-600", "bg-info-600"],
                ["--color-info-700", "bg-info-700"],
              ] as const
            ).map(([token, cls]) => (
              <DsSwatch key={token} token={token} className={cls} />
            ))}
          </DsDemo>
          <DsDemo
            title="Surfaces, textes et bordures"
            source="--color-{background,surface,foreground,muted,border}*"
            note="Bascule en sombre : ces valeurs changent, leurs noms non."
          >
            <DsSwatch token="--color-background" className="bg-background" />
            <DsSwatch token="--color-surface" className="bg-surface" />
            <DsSwatch token="--color-surface-2" className="bg-surface-2" />
            <DsSwatch token="--color-surface-3" className="bg-surface-3" />
            <DsSwatch token="--color-foreground" className="bg-foreground" />
            <DsSwatch token="--color-muted" className="bg-muted" />
            <DsSwatch token="--color-subtle" className="bg-subtle" />
            <DsSwatch token="--color-border" className="bg-border" />
            <DsSwatch
              token="--color-border-strong"
              className="bg-border-strong"
            />
          </DsDemo>
          <DsDemo
            title="Teintes d'état (halos translucides)"
            source="--color-*-tint"
            note="Les fonds légers des cartes d'alerte. Remplacent ~440 rgba() écrits à la main."
          >
            <DsSwatch
              token="--color-primary-tint"
              className="bg-primary-tint"
            />
            <DsSwatch
              token="--color-success-tint"
              className="bg-success-tint"
            />
            <DsSwatch
              token="--color-warning-tint"
              className="bg-warning-tint"
            />
            <DsSwatch token="--color-danger-tint" className="bg-danger-tint" />
            <DsSwatch token="--color-accent-tint" className="bg-accent-tint" />
          </DsDemo>
        </DsSection>

        <DsSection
          id="typo"
          title="Typographie"
          intro="Sora pour les titres et les chiffres, Plus Jakarta Sans pour le corps, Noto Sans Arabic en RTL. L'échelle est nommée par RÔLE : aucune taille ne s'écrit plus en pixels dans un composant."
        >
          <DsDemo
            title="Familles"
            source="lib/fonts.ts"
            className="block space-y-2"
          >
            <p className="font-display text-heading-sm font-extrabold">
              Sora — titres et montants (font-display)
            </p>
            <p className="text-body-lg">
              Plus Jakarta Sans — corps et interface (par défaut)
            </p>
          </DsDemo>
          <DsDemo
            title="Échelle"
            source="--text-*"
            className="block space-y-1.5"
          >
            {[
              ["text-nano", "9px"],
              ["text-micro", "10px"],
              ["text-caption", "11px"],
              ["text-label", "12px"],
              ["text-label-lg", "12.5px"],
              ["text-body-sm", "13px"],
              ["text-body", "13.5px"],
              ["text-body-lg", "14px"],
              ["text-title-sm", "15px"],
              ["text-title-lg", "17px"],
              ["text-heading-sm", "18px"],
              ["text-display-sm", "21px"],
            ].map(([cls, px]) => (
              <div key={cls} className="flex items-baseline gap-3">
                <code className="text-nano text-subtle w-36 shrink-0 font-mono">
                  {cls}
                </code>
                <span className={cls}>Livraison en cours — {px}</span>
              </div>
            ))}
          </DsDemo>
        </DsSection>

        <DsSection
          id="formes"
          title="Rayons & élévation"
          intro="Règle FLAT : les surfaces sont délimitées par des bordures et des fonds doux, jamais par une ombre décorative. L'élévation ne sert qu'à détacher un élément FLOTTANT (menu, feuille, overlay). Les héros dégradés violets sont de la marque, pas du relief."
        >
          <DsDemo title="Rayons" source="--radius-*">
            {[
              ["rounded-sm", "8px"],
              ["rounded-control", "10px"],
              ["rounded-md", "12px"],
              ["rounded-card-lg", "14px"],
              ["rounded-lg", "16px"],
              ["rounded-sheet-lg", "18px"],
              ["rounded-xl", "20px"],
              ["rounded-panel-lg", "26px"],
            ].map(([cls, px]) => (
              <div key={cls} className="w-[104px]">
                <div
                  className={cn(
                    "border-border-strong bg-surface-2 text-nano text-muted grid h-14 place-items-center border",
                    cls
                  )}
                >
                  {px}
                </div>
                <code className="text-nano text-subtle mt-1 block truncate font-mono">
                  {cls}
                </code>
              </div>
            ))}
          </DsDemo>
          <DsDemo
            title="Élévation fonctionnelle"
            source="--shadow-*"
            note="À réserver aux éléments flottants. Sur une carte posée dans le flux, c'est une bordure qu'il faut."
          >
            {[
              "shadow-float",
              "shadow-pop",
              "shadow-overlay",
              "shadow-sheet",
            ].map((cls) => (
              <div key={cls} className="w-[140px]">
                <div
                  className={cn(
                    "bg-surface grid h-16 place-items-center rounded-md",
                    cls
                  )}
                />
                <code className="text-nano text-subtle mt-2 block truncate font-mono">
                  {cls}
                </code>
              </div>
            ))}
          </DsDemo>
        </DsSection>

        <DsSection
          id="mouvement"
          title="Mouvement"
          intro="Trois durées et une courbe. Toutes les animations se neutralisent sous « animations réduites » — c'est un réglage d'accessibilité, pas une option."
        >
          <DsDemo title="Durées & courbe" source="--duration-* / --ease-spring">
            {[
              ["--duration-fast", "160 ms", "survols, bascules"],
              ["--duration-base", "220 ms", "feuilles, panneaux"],
              ["--duration-slow", "400 ms", "entrées d'écran"],
            ].map(([token, val, usage]) => (
              <div
                key={token}
                className="rounded-control border-border border px-3 py-2"
              >
                <code className="text-nano text-foreground block font-mono">
                  {token}
                </code>
                <span className="text-caption text-muted">
                  {val} — {usage}
                </span>
              </div>
            ))}
          </DsDemo>
        </DsSection>

        <DsSection
          id="boutons"
          title="Boutons"
          intro="Tout bouton qui déclenche une action asynchrone passe en « pending » DÈS le clic, avec un état LOCAL : dans une liste, cliquer une ligne ne fige jamais les autres."
        >
          <DsDemo title="Intentions" source="components/ui/button.tsx">
            <Button>Confirmer</Button>
            <Button variant="secondary">Secondaire</Button>
            <Button variant="outline">Contour</Button>
            <Button variant="ghost">Discret</Button>
            <Button variant="destructive">
              <Trash2 className="size-4" />
              Supprimer
            </Button>
            <Button variant="link">Lien</Button>
          </DsDemo>
          <DsDemo title="Tailles" source="components/ui/button.tsx">
            <Button size="sm">Petit</Button>
            <Button>Normal</Button>
            <Button size="lg">Grand</Button>
            <Button size="icon" aria-label="Ajouter">
              <Package className="size-4" />
            </Button>
          </DsDemo>
          <DsDemo title="États" source="components/ui/button.tsx">
            <DsCase label="Normal">
              <Button>Enregistrer</Button>
            </DsCase>
            <DsCase label="Survol">
              <Button className="bg-primary-700">Enregistrer</Button>
            </DsCase>
            <DsCase label="Désactivé">
              <Button disabled>Enregistrer</Button>
            </DsCase>
          </DsDemo>
          <DsDemo
            title="Bouton d'action — cycle complet"
            source="components/ui/action-button.tsx"
            note="Le résultat s'affiche SUR le bouton, pas dans un toast."
          >
            {(["idle", "pending", "success", "error"] as const).map((s) => (
              <DsCase key={s} label={s}>
                <ActionButton
                  state={s}
                  labels={{ idle: "Enregistrer" }}
                  idleIcon={<Save className="size-4" />}
                />
              </DsCase>
            ))}
          </DsDemo>
        </DsSection>

        <DsSection
          id="badges"
          title="Badges"
          intro="Pastilles d'état. Les variantes PÂLES (fond -50) servent sur une carte déjà teintée ; les pleines (-100) sur une surface neutre."
        >
          <DsDemo title="Tons" source="components/ui/badge.tsx">
            <Badge tone="primary">Violet</Badge>
            <Badge tone="success">Payé</Badge>
            <Badge tone="warning">En attente</Badge>
            <Badge tone="danger">Annulé</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="neutral">Neutre</Badge>
          </DsDemo>
          <DsDemo
            title="Variantes pâles & tailles"
            source="components/ui/badge.tsx"
          >
            <Badge tone="successSoft">successSoft</Badge>
            <Badge tone="warningSoft">warningSoft</Badge>
            <Badge tone="dangerSoft">dangerSoft</Badge>
            <Badge tone="primary" size="sm">
              <Bike className="size-3" />
              Compact
            </Badge>
          </DsDemo>
        </DsSection>

        <DsSection
          id="formulaires"
          title="Formulaires"
          intro="Un message de validation s'affiche EN LIGNE, sous le champ concerné — jamais en toast. Le libellé, l'aide et l'erreur sont reliés au contrôle pour les lecteurs d'écran."
        >
          <DsDemo
            title="Champ — états"
            source="components/ui/field.tsx"
            className="grid gap-4 sm:grid-cols-3"
          >
            <Field
              label="Nom du commerce"
              htmlFor="ds-a"
              hint="Visible par les clients"
            >
              <Input {...fieldControlProps("ds-a")} placeholder="Chez Karim" />
            </Field>
            <Field
              label="Téléphone"
              htmlFor="ds-b"
              required
              error="Numéro invalide"
            >
              <Input
                {...fieldControlProps("ds-b", { error: true })}
                defaultValue="06 12"
                className="border-danger-500"
              />
            </Field>
            <Field label="Référence" htmlFor="ds-c" hint="Non modifiable">
              <Input {...fieldControlProps("ds-c")} disabled value="CG-2048" />
            </Field>
          </DsDemo>
          <DsDemo
            title="Libellé & séparateur"
            source="components/ui/label.tsx"
            className="block"
          >
            <Label htmlFor="ds-d">Libellé de champ</Label>
            <Input id="ds-d" className="mt-1.5" placeholder="Saisie…" />
            <Separator className="my-4" />
            <p className="text-caption text-muted">
              Séparateur — components/ui/separator.tsx
            </p>
          </DsDemo>
        </DsSection>

        <DsSection
          id="navigation"
          title="Navigation & réglages"
          intro="La barre segmentée et l'interrupteur suivent la direction du texte : en arabe, la pastille se déplace vers la gauche sans code spécifique."
        >
          <DsDemo
            title="Barre segmentée"
            source="components/ui/segmented.tsx"
            className="block"
          >
            <Segmented
              ariaLabel="Période"
              value={tab}
              onChange={setTab}
              options={[
                { key: "jour", label: "Jour" },
                { key: "semaine", label: "Semaine", badge: 3 },
                { key: "mois", label: "Mois" },
              ]}
            />
          </DsDemo>
          <DsDemo
            title="Interrupteur"
            source="components/ui/toggle.tsx"
            className="block"
          >
            <div className="flex items-center gap-6">
              <DsCase label="Activé">
                <Toggle checked onChange={() => {}} label="Exemple activé" />
              </DsCase>
              <DsCase label="Désactivé">
                <Toggle
                  checked={false}
                  onChange={() => {}}
                  label="Exemple désactivé"
                />
              </DsCase>
              <DsCase label="Inactif">
                <Toggle
                  checked
                  disabled
                  onChange={() => {}}
                  label="Exemple inactif"
                />
              </DsCase>
            </div>
            <Separator className="my-4" />
            <ToggleRow
              title="Recevoir les nouvelles commandes"
              description="Notification sonore à chaque commande entrante"
              checked={toggleOn}
              onChange={setToggleOn}
            />
          </DsDemo>
        </DsSection>

        <DsSection
          id="feedback"
          title="États & retours"
          intro="Chargement, vide, erreur : les trois états qu'un écran doit savoir montrer avant d'avoir ses données."
        >
          <DsDemo
            title="Chargement"
            source="components/ui/spinner.tsx · skeleton.tsx"
            className="block"
          >
            <div className="flex items-center gap-4">
              <Spinner size="sm" />
              <Spinner />
              <Spinner size="lg" />
              <Spinner size="xl" />
            </div>
            <div className="mt-4 max-w-sm space-y-3">
              <Skeleton className="h-10" />
              <SkeletonText lines={3} />
            </div>
          </DsDemo>
          <DsDemo
            title="État vide"
            source="components/ui/empty-state.tsx"
            className="block"
          >
            <EmptyState
              icon={Inbox}
              title="Aucune commande aujourd'hui"
              description="Les nouvelles commandes apparaîtront ici dès qu'un client validera son panier."
              action={<Button size="sm">Partager ma boutique</Button>}
            />
          </DsDemo>
        </DsSection>

        <DsSection
          id="surfaces"
          title="Surfaces flottantes"
          intro="Une seule primitive de feuille : ancrée en bas sur mobile, centrée sur grand écran, avec la zone sûre et la fermeture au clavier déjà gérées."
        >
          <DsDemo title="Feuille / modale" source="components/ui/sheet.tsx">
            <Button onClick={() => setSheetOpen(true)}>
              Ouvrir la feuille
            </Button>
            <Sheet
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              title="Confirmer le retrait"
              description="Le client récupérera sa commande en boutique."
              footer={
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setSheetOpen(false)}
                  >
                    Annuler
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => setSheetOpen(false)}
                  >
                    Confirmer
                  </Button>
                </div>
              }
            >
              <p className="text-body-sm text-muted">
                Contenu de la feuille. Elle se ferme avec Échap, par le voile,
                ou par la croix — et respecte la zone sûre du bas sur mobile.
              </p>
            </Sheet>
          </DsDemo>
        </DsSection>
      </main>
    </div>
  );
}
