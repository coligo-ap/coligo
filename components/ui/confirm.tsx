"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Confirmation IMPÉRATIVE et designée — remplace `window.confirm` (dialogue
 * natif) par une modale aux couleurs du produit, SANS restructurer chaque
 * appelant : `if (!(await confirm({ title }))) return;` est un drop-in direct.
 *
 * Usage : envelopper une fois (ex. MerchantShell) avec <ConfirmProvider>, puis
 * `const confirm = useConfirm();` dans les composants. Hors provider, on retombe
 * sur `window.confirm` (jamais de crash).
 */
type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type Req = ConfirmOpts & { resolve: (v: boolean) => void };

const Ctx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null);

export function useConfirm(): (o: ConfirmOpts) => Promise<boolean> {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  // Repli hors provider : confirmation native (sécurité, pas de crash).
  return async (o: ConfirmOpts) =>
    typeof window !== "undefined" &&
    window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<Req | null>(null);

  const confirm = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) => setReq({ ...o, resolve })),
    []
  );

  const close = useCallback((value: boolean) => {
    setReq((cur) => {
      cur?.resolve(value);
      return null;
    });
  }, []);

  // Échap = annuler.
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, close]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {req && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => close(false)}
        >
          <div
            className="bg-surface border-border w-full max-w-sm rounded-2xl border p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-foreground text-base font-bold">{req.title}</h2>
            {req.message && (
              <p className="text-muted mt-1.5 text-sm leading-relaxed">
                {req.message}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="border-border text-foreground hover:bg-surface-2 rounded-[10px] border px-4 py-2 text-sm font-semibold transition-colors"
              >
                {req.cancelLabel ?? "Annuler"}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`rounded-[10px] px-4 py-2 text-sm font-semibold text-white transition-colors ${
                  req.danger
                    ? "bg-danger-600 hover:bg-danger-700"
                    : "bg-primary-600 hover:bg-primary-700"
                }`}
              >
                {req.confirmLabel ?? "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
