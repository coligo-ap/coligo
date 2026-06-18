"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Dialogues IMPÉRATIFS et designés — remplacent `window.confirm` / `window.prompt`
 * (dialogues natifs) par des modales aux couleurs du produit, SANS restructurer
 * les appelants :
 *   - `if (!(await confirm({ title }))) return;`            (booléen)
 *   - `const reason = await prompt({ title }); if (reason === null) return;` (texte)
 *
 * Usage : envelopper une fois (ex. MerchantShell, AdminLayout) avec
 * <ConfirmProvider>, puis `const confirm = useConfirm()` / `const prompt =
 * usePrompt()`. Hors provider → repli natif (jamais de crash).
 */
type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type PromptOpts = {
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Saisie sur plusieurs lignes (textarea). */
  multiline?: boolean;
};
type Req =
  | (ConfirmOpts & { kind: "confirm"; resolve: (v: boolean) => void })
  | (PromptOpts & { kind: "prompt"; resolve: (v: string | null) => void });

const ConfirmCtx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(
  null
);
const PromptCtx = createContext<
  ((o: PromptOpts) => Promise<string | null>) | null
>(null);

export function useConfirm(): (o: ConfirmOpts) => Promise<boolean> {
  const ctx = useContext(ConfirmCtx);
  if (ctx) return ctx;
  return async (o) =>
    typeof window !== "undefined" &&
    window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title);
}

export function usePrompt(): (o: PromptOpts) => Promise<string | null> {
  const ctx = useContext(PromptCtx);
  if (ctx) return ctx;
  return async (o) =>
    typeof window === "undefined"
      ? null
      : window.prompt(
          o.message ? `${o.title}\n\n${o.message}` : o.title,
          o.initialValue ?? ""
        );
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<Req | null>(null);
  const [value, setValue] = useState("");

  const confirm = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) =>
        setReq({ ...o, kind: "confirm", resolve })
      ),
    []
  );
  const prompt = useCallback(
    (o: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setValue(o.initialValue ?? "");
        setReq({ ...o, kind: "prompt", resolve });
      }),
    []
  );

  const finish = useCallback((result: boolean | string | null) => {
    setReq((cur) => {
      if (cur) {
        if (cur.kind === "confirm") cur.resolve(Boolean(result));
        else cur.resolve(result as string | null);
      }
      return null;
    });
  }, []);

  const cancel = useCallback(
    () => finish(req?.kind === "prompt" ? null : false),
    [finish, req]
  );

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, cancel]);

  return (
    <ConfirmCtx.Provider value={confirm}>
      <PromptCtx.Provider value={prompt}>
        {children}
        {req && (
          <div
            className="fixed inset-0 z-[200] grid place-items-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            onClick={cancel}
          >
            <div
              className="bg-surface border-border w-full max-w-sm rounded-2xl border p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-foreground text-base font-bold">
                {req.title}
              </h2>
              {req.message && (
                <p className="text-muted mt-1.5 text-sm leading-relaxed">
                  {req.message}
                </p>
              )}
              {req.kind === "prompt" &&
                (req.multiline ? (
                  <textarea
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={req.placeholder}
                    rows={3}
                    className="border-border bg-surface-2 text-foreground mt-3 w-full resize-none rounded-[10px] border px-3 py-2 text-sm outline-none focus:border-[color:var(--color-primary-500)]"
                  />
                ) : (
                  <input
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finish(value);
                    }}
                    placeholder={req.placeholder}
                    className="border-border bg-surface-2 text-foreground mt-3 w-full rounded-[10px] border px-3 py-2 text-sm outline-none focus:border-[color:var(--color-primary-500)]"
                  />
                ))}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  className="border-border text-foreground hover:bg-surface-2 rounded-[10px] border px-4 py-2 text-sm font-semibold transition-colors"
                >
                  {req.cancelLabel ?? "Annuler"}
                </button>
                <button
                  type="button"
                  onClick={() => finish(req.kind === "prompt" ? value : true)}
                  className={`rounded-[10px] px-4 py-2 text-sm font-semibold text-white transition-colors ${
                    req.kind === "confirm" && req.danger
                      ? "bg-danger-600 hover:bg-danger-700"
                      : "bg-primary-600 hover:bg-primary-700"
                  }`}
                >
                  {req.confirmLabel ??
                    (req.kind === "prompt" ? "Valider" : "Confirmer")}
                </button>
              </div>
            </div>
          </div>
        )}
      </PromptCtx.Provider>
    </ConfirmCtx.Provider>
  );
}
