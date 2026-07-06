// =============================================================================
// Validation SERVEUR des fichiers uploadés — défense en profondeur.
// =============================================================================
// RÈGLE : ne JAMAIS faire confiance à `file.type` (déclaré par le client, donc
// falsifiable). On lit les PREMIERS OCTETS (magic bytes) pour déterminer le
// VRAI format, et c'est ce format vérifié qui décide :
//   • si le fichier est accepté (allowlist stricte par usage) ;
//   • le contentType envoyé au Storage (celui avec lequel il sera SERVI) ;
//   • l'extension du nom de fichier (générée, jamais reprise du client).
//
// Formats volontairement NON supportés :
//   • SVG : vecteur d'XSS (peut embarquer <script>) — refusé partout ;
//   • HTML/JS/etc. : jamais légitime ici ;
//   • polyglottes déclarés "image/*" : démasqués par la signature réelle.
//
// Usage (Server Action) :
//   const v = await validateUploadedFile(file, { kind: "image", maxBytes: 5 * MB });
//   if (!v.ok) return { error: v.error };
//   await storage.upload(`x-${crypto.randomUUID()}.${v.ext}`, v.bytes,
//                        { contentType: v.mime });
// =============================================================================

export const MB = 1024 * 1024;

export type ValidatedFile = {
  ok: true;
  /** Type MIME RÉEL, déduit de la signature binaire (pas du client). */
  mime: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  /** Extension sûre correspondante ("png" | "jpg" | "webp" | "pdf"). */
  ext: "png" | "jpg" | "webp" | "pdf";
  /** Contenu (déjà lu pour le sniffing) — à passer directement à l'upload. */
  bytes: Uint8Array;
};

export type FileValidationError = { ok: false; error: string };

/** Compare les octets à une signature à un offset donné. */
function matches(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/** Détermine le format réel via la signature binaire. null = non reconnu. */
export function sniffFileType(
  bytes: Uint8Array
): { mime: ValidatedFile["mime"]; ext: ValidatedFile["ext"] } | null {
  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", ext: "png" };
  }
  // JPEG : FF D8 FF
  if (matches(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  // WebP : "RIFF" .... "WEBP"
  if (
    matches(bytes, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    matches(bytes, [0x57, 0x45, 0x42, 0x50], 8) // WEBP
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  // PDF : "%PDF-"
  if (matches(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { mime: "application/pdf", ext: "pdf" };
  }
  return null;
}

/**
 * Valide un fichier uploadé côté SERVEUR : taille bornée + format réel vérifié
 * par signature binaire, restreint à l'usage déclaré.
 *  - kind "image"     : PNG / JPEG / WebP uniquement ;
 *  - kind "image-pdf" : images + PDF (documents justificatifs).
 */
export async function validateUploadedFile(
  file: unknown,
  opts: { kind: "image" | "image-pdf"; maxBytes: number }
): Promise<ValidatedFile | FileValidationError> {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier sélectionné." };
  }
  if (file.size > opts.maxBytes) {
    const mb = Math.round((opts.maxBytes / MB) * 10) / 10;
    return { ok: false, error: `Fichier trop lourd (${mb} Mo maximum).` };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: "Fichier illisible. Réessayez." };
  }

  const sniffed = sniffFileType(bytes);
  if (!sniffed) {
    return {
      ok: false,
      error:
        opts.kind === "image-pdf"
          ? "Format non reconnu. PNG, JPG, WEBP ou PDF uniquement."
          : "Format non reconnu. PNG, JPG ou WEBP uniquement.",
    };
  }
  if (opts.kind === "image" && sniffed.mime === "application/pdf") {
    return {
      ok: false,
      error: "PDF refusé ici : envoyez une image (PNG, JPG, WEBP).",
    };
  }

  return { ok: true, mime: sniffed.mime, ext: sniffed.ext, bytes };
}
