"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Hash, Loader2, QrCode, XCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { validatePickupCode } from "@/app/(merchant)/orders/actions";

type Tab = "code" | "qr";
type Result = { ok: boolean; message: string; orderId?: string };

export function PickupValidator() {
  const [tab, setTab] = useState<Tab>("qr");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(code: string) {
    setResult(null);
    const operationId = crypto.randomUUID();
    startTransition(async () => {
      const res = await validatePickupCode(code, operationId);
      setResult({
        ok: !res.error,
        message: res.error ?? res.success ?? "",
        orderId: res.orderId,
      });
    });
  }

  return (
    <div className="mx-auto max-w-md">
      {/* Onglets */}
      <div className="bg-surface-3 mb-6 grid grid-cols-2 gap-1 rounded-[12px] p-1">
        <TabButton active={tab === "code"} onClick={() => setTab("code")}>
          <Hash className="size-4" />
          Code
        </TabButton>
        <TabButton active={tab === "qr"} onClick={() => setTab("qr")}>
          <QrCode className="size-4" />
          Scanner QR
        </TabButton>
      </div>

      {result?.ok ? (
        <SuccessPanel result={result} onReset={() => setResult(null)} />
      ) : (
        <>
          {tab === "code" ? (
            <CodeTab pending={pending} onSubmit={submit} />
          ) : (
            <QrTab pending={pending} onScan={submit} />
          )}

          {result && !result.ok && (
            <div className="text-danger-700 bg-danger-50 mt-4 flex items-center gap-2 rounded-[12px] px-4 py-3 text-sm">
              <XCircle className="size-4 shrink-0" />
              {result.message}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-10 items-center justify-center gap-2 rounded-[9px] text-sm font-medium transition-colors",
        active
          ? "text-primary-700 bg-white shadow-sm"
          : "text-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------- Onglet code ------------------------------ */

function CodeTab({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (code: string) => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  function setDigit(i: number, value: string) {
    const d = value.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = d;
      return next;
    });
    if (d && i < 5) inputs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(6).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    inputs.current[Math.min(pasted.length, 5)]?.focus();
  }

  const code = digits.join("");
  const complete = code.length === 6;

  return (
    <div className="border-border bg-surface rounded-[16px] border p-5">
      <p className="text-muted mb-4 text-center text-sm">
        Saisissez le code à 6 chiffres présenté par le client.
      </p>

      <div className="mb-5 flex justify-center gap-2" onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            inputMode="numeric"
            maxLength={1}
            autoFocus={i === 0}
            disabled={pending}
            aria-label={`Chiffre ${i + 1}`}
            className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 size-12 rounded-[12px] border text-center text-xl font-semibold tabular-nums focus:ring-2 focus:outline-none disabled:opacity-50"
          />
        ))}
      </div>

      <Button
        size="lg"
        className="w-full"
        disabled={!complete || pending}
        onClick={() => onSubmit(code)}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        Valider la remise
      </Button>
    </div>
  );
}

/* -------------------------------- Onglet QR ------------------------------- */

function QrTab({
  pending,
  onScan,
}: {
  pending: boolean;
  onScan: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const scannedRef = useRef(false);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    scannedRef.current = false;

    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current ?? undefined,
          (res) => {
            if (!res || scannedRef.current) return;
            const code = res.getText().replace(/\D/g, "").slice(0, 6);
            if (code.length === 6) {
              scannedRef.current = true;
              onScan(code);
            }
          }
        );
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
      } catch {
        if (!cancelled)
          setError(
            "Caméra indisponible. Autorisez l'accès ou saisissez le code manuellement."
          );
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [onScan]);

  return (
    <div className="border-border bg-surface rounded-[16px] border p-5">
      <p className="text-muted mb-4 text-center text-sm">
        Présentez le QR code de la commande devant la caméra.
      </p>

      <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-[16px] bg-black">
        <video
          ref={videoRef}
          className="size-full object-cover"
          muted
          playsInline
        />
        {/* Cadre de scan + ligne animée */}
        <div className="pointer-events-none absolute inset-6 rounded-[12px] border-2 border-white/80" />
        <div className="bg-primary-400/80 pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 animate-pulse" />
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-danger-600 mt-4 text-center text-sm">{error}</p>
      )}
    </div>
  );
}

/* ------------------------------- Succès ----------------------------------- */

function SuccessPanel({
  result,
  onReset,
}: {
  result: Result;
  onReset: () => void;
}) {
  return (
    <div className="border-success-200 bg-success-50 rounded-[16px] border p-6 text-center">
      <CheckCircle2 className="text-success-600 mx-auto mb-3 size-12" />
      <p className="text-success-800 text-lg font-semibold">Retrait validé</p>
      <p className="text-success-700 mt-1 text-sm">{result.message}</p>
      <div className="mt-5 flex flex-col gap-2">
        {result.orderId && (
          <Link
            href={`/orders/${result.orderId}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "w-full"
            )}
          >
            Voir la commande
          </Link>
        )}
        <Button size="lg" className="w-full" onClick={onReset}>
          Valider un autre retrait
        </Button>
      </div>
    </div>
  );
}
