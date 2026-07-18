"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronRight,
  Loader2,
  ScanBarcode,
  ShoppingBag,
  X,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { isFractionalUnit, minQtyFor } from "@/lib/units";
import { Portal } from "@/components/ui/portal";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { useCartAdd } from "@/components/customer/cart-mono-provider";
import {
  setSearchOpen,
  setSearchQuery,
} from "@/lib/customer/merchant-search-store";
import {
  scanBarcodeFind,
  type ScanFindResult,
} from "@/app/(customer)/barcode-actions";
import type { MatchedProduct } from "@/lib/barcode/match";
import type { BarcodeSurface } from "@/lib/barcode/resolve";

// =============================================================================
// BarcodeScanButton — scan TEMPS RÉEL façon Lidl/Bolt : gros titre, caméra
// RECTANGULAIRE (cadre large adapté aux codes-barres) toujours ouverte ;
// à la détection, flash vert « Code-barres détecté » + vibration SUR la
// caméra, puis une FEUILLE DE RÉSULTATS glisse depuis le bas (prix, « chez
// {commerçant} » sur l'accueil), AJOUT PANIER direct (produit simple) ou
// « Voir » (options/poids → boutique avec recherche préremplie). Le scan
// reste ARMÉ en continu : viser un AUTRE produit remplace le résultat tout
// seul (« Scanner un autre produit » = simple raccourci de nettoyage). Non
// résolu → message + repli recherche texte. Rendu GATÉ côté serveur.
// =============================================================================

type Panel =
  | { kind: "scanning" }
  | { kind: "searching"; ean: string }
  | { kind: "found"; name: string; products: MatchedProduct[] }
  | { kind: "no-match"; name: string }
  | { kind: "not-found"; ean: string };

export function BarcodeScanButton({
  surface,
  merchantId = null,
  onFound,
  className,
}: {
  surface: BarcodeSurface;
  /** Fiche commerçant : borne les résultats à CE commerce. */
  merchantId?: string | null;
  /** Repli « recherche texte » : reçoit le nom résolu. */
  onFound: (name: string) => void;
  className?: string;
}) {
  const t = useTranslations("barcode");
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>({ kind: "scanning" });
  // Produits déjà résolus dans CETTE session de scan : réaffichés dans le
  // panneau pendant le scan → l'espace sous la caméra ne reste jamais vide et
  // un produit vu plus tôt reste ajoutable sans re-scanner.
  const [recent, setRecent] = useState<MatchedProduct[]>([]);
  // SCAN CONTINU : la détection reste ARMÉE même quand un résultat est
  // affiché — pointer un AUTRE produit remplace le résultat tout seul, sans
  // « Scanner un autre produit ». Garde-fous : une seule recherche en vol,
  // et le MÊME code encore dans le champ ne relance pas (fenêtre glissante).
  const searchingRef = useRef(false);
  const lastEanRef = useRef<{ ean: string; at: number } | null>(null);
  // Flash « Code-barres détecté » PAR-DESSUS la caméra (feedback immédiat
  // façon grandes apps de scan) — auto-effacé, doublé d'une vibration.
  const [detected, setDetected] = useState(false);
  const detectTimerRef = useRef<number | null>(null);

  function reset() {
    setPanel({ kind: "scanning" });
    setDetected(false);
    lastEanRef.current = null;
  }

  async function handleScan(raw: string) {
    const ean = raw.replace(/\D/g, "");
    if (ean.length < 8) return;
    if (searchingRef.current) return;
    const now = Date.now();
    const last = lastEanRef.current;
    if (last && last.ean === ean && now - last.at < 5000) {
      // Même produit toujours devant la caméra : on repousse la fenêtre au
      // lieu de relancer la même recherche en boucle.
      last.at = now;
      return;
    }
    lastEanRef.current = { ean, at: now };
    searchingRef.current = true;
    if (detectTimerRef.current) window.clearTimeout(detectTimerRef.current);
    setDetected(true);
    detectTimerRef.current = window.setTimeout(() => setDetected(false), 1200);
    try {
      navigator.vibrate?.(60);
    } catch {
      /* vibration indisponible : feedback visuel seul */
    }
    setPanel({ kind: "searching", ean });
    try {
      const res: ScanFindResult = await scanBarcodeFind({
        ean,
        surface,
        merchantId,
      });
      if (!res.ok) {
        setPanel({ kind: "not-found", ean });
        return;
      }
      if (res.products.length === 0) {
        setPanel({ kind: "no-match", name: res.name });
        return;
      }
      setPanel({ kind: "found", name: res.name, products: res.products });
      setRecent((prev) => {
        const ids = new Set(res.products.map((p) => p.product_id));
        return [
          ...res.products,
          ...prev.filter((p) => !ids.has(p.product_id)),
        ].slice(0, 8);
      });
    } finally {
      searchingRef.current = false;
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setRecent([]);
          setOpen(true);
        }}
        aria-label={t("button")}
        className={cn(
          "text-foreground hover:text-primary-700 shrink-0 transition-colors",
          className
        )}
      >
        <ScanBarcode className="size-5" />
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[120] bg-black">
            <style>{`
              @keyframes bsSheetUp{from{transform:translateY(100%)}to{transform:none}}
              @keyframes bsPop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
              @keyframes bsFlashIn{from{opacity:0}to{opacity:1}}
            `}</style>

            {/* GROS titre : lecture immédiate « scan code-barres », pas QR. */}
            <div className="flex items-start justify-between gap-3 px-5 pt-[calc(env(safe-area-inset-top)+0.875rem)]">
              <h2 className="text-[26px] leading-8 font-extrabold text-white">
                {t("title")}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("close")}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15 text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Caméra TOUJOURS montée (scan continu) — carte RECTANGULAIRE
                large (cadre code-barres) ; le flash « détecté » s'affiche
                par-dessus. */}
            <div className="px-4 pt-4">
              <div className="relative mx-auto w-full max-w-[430px]">
                <QrScanner
                  mode="barcode"
                  oneShot={false}
                  onScan={(text) => void handleScan(text)}
                  className="aspect-[7/5] w-full max-w-none overflow-hidden rounded-[24px]"
                />
                {detected && (
                  <div className="ring-success-500 pointer-events-none absolute inset-0 z-10 grid animate-[bsFlashIn_.15s_ease] place-items-center rounded-[24px] bg-black/45 ring-4 ring-inset">
                    <div className="flex flex-col items-center gap-2.5">
                      <span className="bg-success-500 grid size-14 animate-[bsPop_.3s_ease] place-items-center rounded-full text-white">
                        <Check className="size-8" strokeWidth={3} />
                      </span>
                      <p className="text-[16px] font-extrabold text-white">
                        {t("detected")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* FEUILLE DE RÉSULTATS : glisse depuis le bas dès qu'un code est
                lu (comportement scanner des grandes apps) ; repliée pendant le
                scan, elle ne montre que la consigne + les scans récents. */}
            <div
              key={panel.kind === "scanning" ? "idle" : "result"}
              className="absolute inset-x-0 bottom-0 z-10 flex max-h-[55dvh] animate-[bsSheetUp_.32s_cubic-bezier(.16,1,.3,1)] flex-col rounded-t-[24px] bg-white shadow-[0_-8px_30px_rgba(0,0,0,.35)]"
            >
              <span className="bg-border mx-auto mt-2 h-1 w-10 shrink-0 rounded-full" />
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {panel.kind === "scanning" && (
                  <>
                    <p className="text-muted py-3 text-center text-[13px] font-semibold">
                      {t("hint")}
                    </p>
                    {recent.length > 0 && (
                      <>
                        <p className="text-subtle mt-1 mb-1 text-[11px] font-extrabold tracking-wide uppercase">
                          {t("recent")}
                        </p>
                        <ul className="divide-border divide-y">
                          {recent.map((p) => (
                            <ResultRow
                              key={p.product_id}
                              product={p}
                              surface={surface}
                              onNavigate={() => setOpen(false)}
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}

                {panel.kind === "searching" && (
                  <p className="text-foreground inline-flex w-full items-center justify-center gap-2 py-3 text-[13.5px] font-bold">
                    <Loader2 className="text-primary-600 size-4 animate-spin" />
                    {t("searching")}
                  </p>
                )}

                {panel.kind === "found" && (
                  <>
                    <p className="text-foreground text-[14px] font-extrabold">
                      {panel.name}
                    </p>
                    <p className="text-muted mb-2 text-[11.5px] font-medium">
                      {t("foundCount", { count: panel.products.length })}
                    </p>
                    <ul className="divide-border divide-y">
                      {panel.products.map((p) => (
                        <ResultRow
                          key={p.product_id}
                          product={p}
                          surface={surface}
                          onNavigate={() => setOpen(false)}
                        />
                      ))}
                    </ul>
                  </>
                )}

                {panel.kind === "no-match" && (
                  <div className="py-2 text-center">
                    <p className="text-foreground text-[13.5px] font-bold">
                      {t("noMatch", { name: panel.name })}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onFound(panel.name);
                      }}
                      className="text-primary-700 mt-2 text-[13px] font-bold underline"
                    >
                      {t("searchInstead", { name: panel.name })}
                    </button>
                  </div>
                )}

                {panel.kind === "not-found" && (
                  <p className="text-foreground py-2 text-center text-[13.5px] font-bold">
                    {t("notFound", { ean: panel.ean })}
                  </p>
                )}

                {panel.kind !== "scanning" && (
                  <button
                    type="button"
                    onClick={reset}
                    className="border-border text-foreground mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border text-[13.5px] font-extrabold"
                  >
                    <ScanBarcode className="size-4" />
                    {t("scanAgain")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

/** Ligne de résultat : photo · nom (+ « chez {commerçant} » sur l'accueil) ·
 *  prix · Ajouter (direct) ou Voir (options/poids → boutique préremplie). */
function ResultRow({
  product,
  surface,
  onNavigate,
}: {
  product: MatchedProduct;
  surface: BarcodeSurface;
  onNavigate: () => void;
}) {
  const t = useTranslations("barcode");
  const router = useRouter();
  const { requestAdd } = useCartAdd();
  const [added, setAdded] = useState(false);

  const simple = !product.has_options && !isFractionalUnit(product.unit);

  function addToCart() {
    if (added) return;
    requestAdd(
      {
        id: product.merchant.id,
        slug: product.merchant.slug,
        name: product.merchant.name,
        logo_url: product.merchant.logo_url,
      },
      {
        product_id: product.product_id,
        name: product.name_fr,
        name_ar: product.name_ar,
        unit: product.unit,
        min_qty: product.min_qty,
        max_qty: product.max_qty,
        unit_price_da: product.price_da,
        image_url: product.image_url,
        category_title: product.category,
        options: [],
        quantity: minQtyFor(product.unit, product.min_qty),
      }
    );
    setAdded(true);
  }

  /** Options/poids : direction la boutique, recherche préremplie sur CE nom. */
  function view() {
    setSearchQuery(product.name_fr);
    setSearchOpen(true);
    onNavigate();
    if (surface === "marketplace") {
      router.push(`/m/${product.merchant.slug}`);
    }
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      {product.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.image_url}
          alt=""
          className="bg-surface-2 size-11 shrink-0 rounded-[10px] object-contain"
        />
      ) : (
        <span className="bg-surface-2 text-subtle grid size-11 shrink-0 place-items-center rounded-[10px]">
          <ShoppingBag className="size-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="text-foreground line-clamp-1 text-[13.5px] font-bold">
          {product.name_fr}
        </span>
        {surface === "marketplace" && (
          <span className="text-muted line-clamp-1 text-[11.5px] font-medium">
            {t("atMerchant", { name: product.merchant.name })}
          </span>
        )}
        <span className="text-primary-700 text-[13px] font-extrabold tabular-nums">
          {formatDA(product.price_da)}
        </span>
      </span>
      {simple ? (
        <button
          type="button"
          onClick={addToCart}
          disabled={added}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3.5 text-[12.5px] font-extrabold text-white transition-colors",
            added ? "bg-success-600" : "bg-primary-600 hover:bg-primary-700"
          )}
        >
          {added ? (
            <>
              <Check className="size-4" />
              {t("added")}
            </>
          ) : (
            t("add")
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={view}
          className="border-border text-foreground inline-flex h-9 shrink-0 items-center gap-0.5 rounded-full border px-3 text-[12.5px] font-extrabold"
        >
          {t("view")}
          <ChevronRight className="size-3.5 rtl:rotate-180" />
        </button>
      )}
    </li>
  );
}
