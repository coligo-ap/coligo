"use server";

import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locale";

/**
 * Change la langue active : pose le cookie `NEXT_LOCALE` (1 an). Le composant
 * appelant rafraîchit ensuite la route pour re-rendre avec la nouvelle locale.
 */
export async function setLocale(next: string): Promise<{ locale: Locale }> {
  const locale = isLocale(next) ? next : DEFAULT_LOCALE;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return { locale };
}
