"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Échafaudage de la vitrine : sections, démos et pastilles de couleur.
 * Ces composants ne servent QUE la page /design-system — ils ne font pas
 * partie de la bibliothèque de l'app.
 */

/** Section navigable. L'`id` sert d'ancre au sommaire latéral. */
export function DsSection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-border scroll-mt-20 border-t pt-8">
      <h2 className="text-heading-sm text-foreground font-extrabold">
        {title}
      </h2>
      {intro && (
        <p className="text-body-sm text-muted mt-1 max-w-2xl leading-relaxed">
          {intro}
        </p>
      )}
      <div className="mt-5 space-y-6">{children}</div>
    </section>
  );
}

/**
 * Démonstration d'un composant. `source` affiche le fichier d'où il vient :
 * c'est ce qui rend la vitrine utile — on voit le rendu ET où le modifier.
 */
export function DsDemo({
  title,
  source,
  note,
  children,
  className,
}: {
  title: string;
  /** Chemin du fichier source, depuis la racine du projet. */
  source?: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="border-border bg-surface rounded-md border">
      <div className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <h3 className="text-body-sm text-foreground font-bold">{title}</h3>
        {source && (
          <code className="rounded-chip bg-surface-2 text-nano-lg text-muted px-2 py-0.5 font-mono">
            {source}
          </code>
        )}
      </div>
      {note && (
        <p className="border-border text-caption text-muted border-b px-4 py-2">
          {note}
        </p>
      )}
      <div className={cn("flex flex-wrap items-center gap-3 p-4", className)}>
        {children}
      </div>
    </div>
  );
}

/** Étiquette d'état au-dessus d'un échantillon (« survol », « désactivé »…). */
export function DsCase({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-nano-lg text-subtle font-semibold tracking-wide uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Pastille de couleur : le rendu réel, le NOM du token et sa valeur calculée.
 * La valeur est lue sur l'élément au montage — elle suit donc le thème actif,
 * ce qui rend visible le fait qu'un token sémantique change entre clair et
 * sombre alors que son nom, lui, ne bouge jamais.
 */
export function DsSwatch({
  token,
  className,
}: {
  /** Nom de la variable CSS, ex. `--color-primary-600`. */
  token: string;
  /** Classe utilitaire correspondante, ex. `bg-primary-600`. */
  className: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setValue(
        getComputedStyle(el).getPropertyValue(token).trim() ||
          getComputedStyle(el).backgroundColor
      );
    read();
    // Le thème bascule par une classe sur <html> : on relit à ce moment-là.
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "dir"],
    });
    return () => obs.disconnect();
  }, [token]);

  return (
    <div ref={ref} className="w-[128px]">
      <div
        className={cn("rounded-control border-border h-12 border", className)}
      />
      <code className="text-nano text-foreground mt-1 block truncate font-mono">
        {token}
      </code>
      <code className="text-nano text-subtle block truncate font-mono">
        {value}
      </code>
    </div>
  );
}
