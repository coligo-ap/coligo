"use client";

import { useCallback, useState } from "react";
import { RefreshCw, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrScanner } from "@/components/scanner/qr-scanner";

export default function DevScanPage() {
  const [text, setText] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);

  const handleScan = useCallback((value: string) => {
    setText(value);
    setScanning(false);
  }, []);

  function rescan() {
    setText(null);
    setScanning(true);
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Démo scanner QR</h1>
        <p className="text-muted mt-1 text-sm">
          Test du composant <code>&lt;QrScanner /&gt;</code> en mode « one-shot
          ».
        </p>
      </header>

      <section className="border-border bg-surface rounded-[14px] border p-5">
        {scanning ? (
          <QrScanner onScan={handleScan} oneShot />
        ) : (
          <div className="space-y-4">
            <div className="border-success-200 bg-success-50 flex items-start gap-3 rounded-[12px] border p-4">
              <ScanLine className="text-success-600 mt-0.5 size-5" />
              <div className="min-w-0 flex-1">
                <p className="text-success-800 text-sm font-medium">
                  QR détecté
                </p>
                <p className="text-success-700 mt-1 font-mono text-xs break-all">
                  {text}
                </p>
              </div>
            </div>
            <Button onClick={rescan} className="w-full">
              <RefreshCw className="size-4" />
              Re-scanner
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
