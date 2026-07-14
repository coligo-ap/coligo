/**
 * Configuration i18n (sans routing par segment d'URL).
 *
 * La locale active est stockée dans un cookie `NEXT_LOCALE` lu côté serveur
 * (i18n/request.ts + layout racine). Par défaut : français.
 */

export const LOCALES = ["fr", "ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Langues écrites de droite à gauche. */
export const RTL_LOCALES: Locale[] = ["ar"];

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "fr" || value === "ar" || value === "en";
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  ar: "العربية",
  en: "English",
};
