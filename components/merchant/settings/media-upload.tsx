"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";

type Props = {
  merchantId: string;
  bucket: "merchant-logos" | "merchant-covers";
  /** URL initiale (ou null si pas encore uploadé). */
  initialUrl: string | null;
  /** Forme du cadre — rond (logo) ou rectangle (cover). */
  variant: "logo" | "cover";
  /** Server Action qui PERSISTE l'URL dans la table merchants. */
  onPersistUrl: (
    url: string | null
  ) => Promise<{ error?: string; ok?: boolean }>;
};

const MAX_BYTES: Record<Props["bucket"], number> = {
  "merchant-logos": 2 * 1024 * 1024,
  "merchant-covers": 5 * 1024 * 1024,
};

const ACCEPT: Record<Props["bucket"], string> = {
  "merchant-logos": "image/png,image/jpeg,image/webp,image/svg+xml",
  "merchant-covers": "image/png,image/jpeg,image/webp",
};

export function MediaUpload({
  merchantId,
  bucket,
  initialUrl,
  variant,
  onPersistUrl,
}: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [note, setNote] = useActionNote();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.size > MAX_BYTES[bucket]) {
      setNote({
        ok: false,
        text: `Image trop lourde (max ${Math.round(MAX_BYTES[bucket] / 1024 / 1024)} Mo)`,
      });
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      // Nom de fichier déterministe : {merchant_id}/{logo|cover}.{ext}
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `${merchantId}/${variant}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(filename, file, { upsert: false, contentType: file.type });
      if (upErr) {
        setNote({ ok: false, text: `Upload échoué : ${upErr.message}` });
        return;
      }
      const { data: pub } = supabase.storage
        .from(bucket)
        .getPublicUrl(filename);
      const publicUrl = pub.publicUrl;

      // Persiste l'URL côté DB.
      const res = await onPersistUrl(publicUrl);
      if (res.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      // Succès : l'aperçu affiche la nouvelle image (setUrl) = feedback visuel.
      setUrl(publicUrl);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function onRemove() {
    startTransition(async () => {
      const res = await onPersistUrl(null);
      if (res.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      // Succès : l'aperçu redevient vide (setUrl null) = feedback visuel.
      setUrl(null);
    });
  }

  const isLogo = variant === "logo";

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "border-border bg-surface-2 relative overflow-hidden border",
          isLogo
            ? "size-24 rounded-full"
            : "rounded-card-lg h-32 w-full sm:h-40"
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={isLogo ? "Logo de la boutique" : "Image de couverture"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-muted flex h-full w-full flex-col items-center justify-center gap-1.5 text-xs">
            <ImagePlus className="size-5" />
            <span>{isLogo ? "Aucun logo" : "Aucune image"}</span>
          </div>
        )}
        {busy && (
          <div className="bg-foreground/40 absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-white" />
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[bucket]}
        className="hidden"
        onChange={onPick}
        disabled={busy}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Upload className="size-3.5" />
          {url ? "Remplacer" : "Téléverser"}
        </Button>
        {url && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="text-danger-600 hover:bg-danger-50 rounded-control inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
          >
            <Trash2 className="size-3.5" />
            Supprimer
          </button>
        )}
      </div>

      <ActionNote note={note} />
    </div>
  );
}
