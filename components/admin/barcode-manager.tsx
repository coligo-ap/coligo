"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  ScanBarcode,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm";
import {
  deleteBarcode,
  upsertBarcode,
} from "@/app/admin/(plateforme)/codes-barres/actions";

// =============================================================================
// BarcodeManager — CRUD du catalogue code-barres (admin plateforme) :
//   • formulaire d'ajout (code / nom / marque) ;
//   • scans NON RÉSOLUS récents → « Ajouter » pré-remplit le formulaire ;
//   • liste filtrable, édition inline, suppression confirmée.
// États pending LOCAUX par ligne (règle produit), erreurs INLINE (pas de toast).
// =============================================================================

type CatalogRow = {
  barcode: string;
  product_name: string;
  brand: string | null;
  source: "admin" | "openfoodfacts";
  updated_at: string;
};

type UnresolvedRow = { barcode: string; n: number; last_at: string };

export function BarcodeManager({
  catalog,
  unresolved,
}: {
  catalog: CatalogRow[];
  unresolved: UnresolvedRow[];
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (r) =>
        r.barcode.includes(needle) ||
        r.product_name.toLowerCase().includes(needle) ||
        (r.brand ?? "").toLowerCase().includes(needle)
    );
  }, [catalog, q]);

  // Formulaire d'ajout (pré-rempli par « Ajouter » d'un scan non résolu).
  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addOk, setAddOk] = useState(false);
  const [adding, startAdd] = useTransition();

  function submitAdd() {
    setAddErr(null);
    setAddOk(false);
    startAdd(async () => {
      const res = await upsertBarcode({
        barcode,
        productName: name,
        brand: brand || null,
      });
      if (res.error) {
        setAddErr(res.error);
        return;
      }
      setAddOk(true);
      setBarcode("");
      setName("");
      setBrand("");
    });
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <ScanBarcode className="size-5" />
          Catalogue code-barres
        </h2>
        <p className="text-muted text-body-sm mt-0.5">
          La saisie admin PRIME sur OpenFoodFacts. Activation par surface :
          onglet « Contrôle services ».
        </p>
      </header>

      {/* Ajout / correction */}
      <section className="border-border rounded-card-lg border bg-white p-4">
        <p className="mb-2 text-sm font-bold">Ajouter / corriger</p>
        <div className="grid gap-2 sm:grid-cols-[180px_1fr_160px_auto]">
          <Input
            value={barcode}
            onChange={(e) => {
              setBarcode(e.target.value.replace(/\D/g, "").slice(0, 14));
              setAddOk(false);
            }}
            inputMode="numeric"
            placeholder="Code (EAN)"
          />
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setAddOk(false);
            }}
            placeholder="Nom du produit"
          />
          <Input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Marque (opt.)"
          />
          <Button
            type="button"
            onClick={submitAdd}
            disabled={adding || barcode.length < 8 || !name.trim()}
          >
            {adding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Enregistrer
          </Button>
        </div>
        {addErr && (
          <p className="text-danger-600 text-label-lg mt-2 font-semibold">
            {addErr}
          </p>
        )}
        {addOk && (
          <p className="text-success-700 text-label-lg mt-2 inline-flex items-center gap-1 font-semibold">
            <Check className="size-3.5" /> Enregistré.
          </p>
        )}
      </section>

      {/* Scans non résolus — enrichissement en un clic */}
      {unresolved.length > 0 && (
        <section className="border-warning-200 bg-warning-50/50 rounded-card-lg border p-4">
          <p className="mb-2 text-sm font-bold">
            Scans non résolus (30 j) — à enrichir
          </p>
          <ul className="divide-border divide-y">
            {unresolved.map((u) => (
              <li
                key={u.barcode}
                className="text-body-sm flex items-center gap-3 py-2"
              >
                <span className="font-mono font-bold tabular-nums">
                  {u.barcode}
                </span>
                <span className="text-muted">
                  {u.n} scan{u.n > 1 ? "s" : ""} ·{" "}
                  {new Date(u.last_at).toLocaleDateString("fr-DZ", {
                    // Fuseau FIXE : serveur UTC vs navigateur Alger ⇒ #418.
                    timeZone: "Africa/Algiers",
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setBarcode(u.barcode);
                    setName("");
                    setAddOk(false);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="text-primary-700 text-label-lg ms-auto font-bold hover:underline"
                >
                  Ajouter
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Catalogue */}
      <section className="border-border rounded-card-lg border bg-white">
        <div className="border-border flex items-center gap-2 border-b p-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer (code, nom, marque)…"
            className="max-w-xs"
          />
          <span className="text-muted text-label ms-auto font-semibold">
            {filtered.length} / {catalog.length}
          </span>
        </div>
        {filtered.length === 0 ? (
          <p className="text-muted px-4 py-8 text-center text-sm">
            Aucun code-barres. Ajoutez-en un ci-dessus — les scans résolus via
            OpenFoodFacts s&apos;ajoutent automatiquement.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {filtered.map((r) => (
              <CatalogLine key={r.barcode} row={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CatalogLine({ row }: { row: CatalogRow }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.product_name);
  const [brand, setBrand] = useState(row.brand ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  function save() {
    setErr(null);
    startSave(async () => {
      const res = await upsertBarcode({
        barcode: row.barcode,
        productName: name,
        brand: brand || null,
      });
      if (res.error) {
        setErr(res.error);
        return;
      }
      setEditing(false);
    });
  }

  async function remove() {
    if (
      !(await confirm({
        title: "Supprimer ce code-barres ?",
        message: `${row.barcode} · ${row.product_name}`,
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startDelete(async () => {
      const res = await deleteBarcode(row.barcode);
      if (res.error) setErr(res.error);
    });
  }

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="text-body-sm w-[130px] shrink-0 font-mono font-bold tabular-nums">
          {row.barcode}
        </span>
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9"
            />
            <Input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Marque"
              className="h-9 max-w-[150px]"
            />
          </div>
        ) : (
          <span className="text-body min-w-0 flex-1 truncate">
            <b>{row.product_name}</b>
            {row.brand && <span className="text-muted"> · {row.brand}</span>}
          </span>
        )}
        <span
          className={cn(
            "text-micro-lg shrink-0 rounded-full px-2 py-0.5 font-extrabold",
            row.source === "admin"
              ? "bg-primary-50 text-primary-700"
              : "bg-surface-2 text-muted"
          )}
        >
          {row.source === "admin" ? "Admin" : "OpenFoodFacts"}
        </span>
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={saving || !name.trim()}
              aria-label="Enregistrer"
              className="text-success-700 hover:bg-success-50 grid size-8 shrink-0 place-items-center rounded-sm disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(row.product_name);
                setBrand(row.brand ?? "");
                setErr(null);
              }}
              aria-label="Annuler"
              className="text-muted hover:bg-surface-2 grid size-8 shrink-0 place-items-center rounded-sm"
            >
              <X className="size-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Modifier"
              className="text-muted hover:bg-surface-2 hover:text-foreground grid size-8 shrink-0 place-items-center rounded-sm"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={deleting}
              aria-label="Supprimer"
              className="text-danger-600 hover:bg-danger-50 grid size-8 shrink-0 place-items-center rounded-sm disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </button>
          </>
        )}
      </div>
      {err && (
        <p className="text-danger-600 text-label mt-1 font-semibold">{err}</p>
      )}
    </li>
  );
}
