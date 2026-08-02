"use server";

import { searchAddresses, type AddressHit } from "@/lib/geo/address-search";

/**
 * Recherche d'adresse pour les écrans client (Drive, livraison, marketplace).
 *
 * Passe par le SERVEUR pour une raison précise : la clé Google ne doit jamais
 * partir dans le navigateur. Un appel direct depuis le téléphone exposerait la
 * clé à qui ouvre les outils de développement — et Google Places est facturé.
 *
 * Le classement (Google d'abord, puis le gazetteer Coligo, puis OpenStreetMap)
 * et la bascule automatique sont décidés dans `lib/geo/address-search`.
 */
export async function searchAddress(
  q: string,
  near?: { lat: number; lng: number } | null
): Promise<AddressHit[]> {
  return searchAddresses(q, near ?? null);
}
