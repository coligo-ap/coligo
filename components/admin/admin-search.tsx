"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import { allAdminItems } from "@/lib/admin/navigation";

// =============================================================================
// SUPER ADMIN — RECHERCHE DE FONCTIONNALITÉ (⌘K / Ctrl+K).
//
// Un dashboard de 60 pages ne se navigue pas : il se cherche. Ici on tape ce
// qu'on veut faire — « recharge », « pass », « ean », « kyc », « commission » —
// et on y est. La recherche porte sur le libellé, sur le domaine, et sur des
// MOTS-CLÉS métier déclarés dans le plan (lib/admin/navigation.ts) : quelqu'un
// qui cherche « payout » trouve « Versements », même si le mot n'est pas écrit
// à l'écran.
// =============================================================================

/** Normalise pour comparer sans accents ni casse (« intégrité » ≡ « integrite »). */
function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function AdminSearchButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);

  // ⌘K / Ctrl+K partout dans l'admin — le raccourci que tout le monde essaie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "border-border text-muted hover:bg-surface-2 hover:text-foreground rounded-control mb-1 flex items-center gap-2 border px-3 py-2 text-sm transition-colors",
          compact ? "size-9 justify-center p-0" : "w-full"
        )}
        aria-label="Rechercher une fonctionnalité"
      >
        <Search className="size-4 shrink-0" />
        {!compact && (
          <>
            <span className="flex-1 text-left">Rechercher…</span>
            <kbd className="border-border text-muted text-micro hidden rounded-[6px] border px-1.5 py-0.5 font-semibold lg:inline">
              ⌘K
            </kbd>
          </>
        )}
      </button>
      {open && <AdminSearchPalette onClose={() => setOpen(false)} />}
    </>
  );
}

function AdminSearchPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const entries = useMemo(() => allAdminItems(), []);
  const results = useMemo(() => {
    const needle = fold(q.trim());
    if (!needle) return entries.slice(0, 8);
    return entries
      .map((e) => {
        const label = fold(e.item.label);
        const domain = fold(e.domain.label);
        const keys = (e.item.keywords ?? []).map(fold);
        // Un titre qui COMMENCE par ce qu'on tape passe devant : c'est presque
        // toujours celui qu'on voulait.
        let score = -1;
        if (label.startsWith(needle)) score = 0;
        else if (label.includes(needle)) score = 1;
        else if (keys.some((k) => k.includes(needle))) score = 2;
        else if (domain.includes(needle)) score = 3;
        return { e, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 10)
      .map((r) => r.e);
  }, [q, entries]);

  useEffect(() => setCursor(0), [q]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    }
    if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      go(results[cursor].item.href);
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
        onClick={onClose}
      >
        <div
          className="border-border bg-surface w-full max-w-lg overflow-hidden rounded-lg border shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-border flex items-center gap-2 border-b px-3">
            <Search className="text-muted size-4 shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Rechercher une page, un réglage, une action…"
              className="h-12 flex-1 bg-transparent text-sm outline-none"
            />
            <kbd className="border-border text-muted text-micro rounded-[6px] border px-1.5 py-0.5 font-semibold">
              Échap
            </kbd>
          </div>

          {results.length === 0 ? (
            <p className="text-muted p-6 text-center text-sm">
              Aucune page pour « {q} ».
            </p>
          ) : (
            <ul className="max-h-[52vh] overflow-y-auto p-1.5">
              {results.map((entry, i) => {
                const Icon = entry.item.icon;
                const on = i === cursor;
                return (
                  <li key={entry.item.href}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(entry.item.href)}
                      className={cn(
                        "rounded-control flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                        on ? "bg-primary-50" : "hover:bg-surface-2"
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          on ? "text-primary-700" : "text-muted"
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {entry.item.label}
                        </span>
                        <span className="text-muted block truncate text-xs">
                          {entry.domain.label}
                          {entry.section ? ` · ${entry.section}` : ""}
                        </span>
                      </span>
                      {on && (
                        <CornerDownLeft className="text-muted size-3.5 shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Portal>
  );
}
