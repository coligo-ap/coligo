"use client";

import { useState, useTransition } from "react";
import { LayoutGrid, Loader2, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setCatalogDisplay } from "@/app/(merchant)/settings/actions";

/**
 * Choix de l'AFFICHAGE du catalogue côté client :
 * - « Liste » (historique) : sections catégories + produits déroulés ;
 * - « Catégories d'abord » : grille de cartes catégories (photo), le client
 *   tape une carte pour entrer dans ses produits (style Uber grocery).
 * Le client garde la main : il peut basculer l'affichage sur la boutique
 * (préférence locale sur son téléphone). Enregistrement immédiat au clic,
 * résultat inline (pas de toast).
 */
export function CatalogDisplayForm({
  initial,
}: {
  initial: "list" | "categories";
}) {
  const [value, setValue] = useState<"list" | "categories">(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  function choose(next: "list" | "categories") {
    if (next === value || pending) return;
    const prev = value;
    setValue(next);
    setMsg(null);
    startTransition(async () => {
      const res = await setCatalogDisplay(next);
      if (res && "error" in res && res.error) {
        setValue(prev);
        setMsg({ kind: "err", text: res.error });
      } else {
        setMsg({ kind: "ok", text: "Affichage enregistré." });
      }
    });
  }

  const OPTIONS = [
    {
      key: "list" as const,
      icon: Rows3,
      title: "Liste complète",
      desc: "Les clients voient toutes les catégories avec leurs produits déroulés (affichage actuel).",
    },
    {
      key: "categories" as const,
      icon: LayoutGrid,
      title: "Catégories d'abord",
      desc: "Les clients voient d'abord vos cartes de catégories (avec photo), puis entrent dans une catégorie pour voir ses produits.",
    },
  ];

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => choose(o.key)}
              disabled={pending}
              aria-pressed={active}
              className={cn(
                "rounded-[14px] border p-4 text-start transition disabled:opacity-60",
                active
                  ? "border-primary-500 bg-primary-50 ring-primary-400/40 ring-2"
                  : "border-border-strong bg-surface hover:border-primary-300"
              )}
            >
              <div className="flex items-center gap-2">
                <o.icon
                  className={cn(
                    "size-4",
                    active ? "text-primary-700" : "text-muted"
                  )}
                />
                <span className="text-sm font-bold">{o.title}</span>
                {pending && active && (
                  <Loader2 className="text-muted ms-auto size-3.5 animate-spin" />
                )}
              </div>
              <p className="text-muted mt-1.5 text-xs">{o.desc}</p>
            </button>
          );
        })}
      </div>
      <p className="text-subtle mt-2 text-xs">
        Le client peut toujours basculer l&apos;affichage sur votre boutique —
        votre choix définit ce qu&apos;il voit par défaut.
      </p>
      {msg && (
        <p
          className={cn(
            "mt-1 text-xs",
            msg.kind === "err" ? "text-danger-600" : "text-emerald-600"
          )}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
