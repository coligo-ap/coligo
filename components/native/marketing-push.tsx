"use client";

import { useEffect } from "react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import {
  syncMarketingTopic,
  PUSH_READY_EVENT,
} from "@/lib/native/marketing-topics";

/**
 * Abonne l'appareil au topic MARKETING de sa wilaya (promos de commerçants
 * proches), INDÉPENDAMMENT de la connexion → un utilisateur DÉCONNECTÉ continue
 * de recevoir les promos de sa zone, tandis que le personnel (adressé par token/
 * user_id) est coupé au logout. Monté SANS condition d'auth dans la coque client.
 * Re-synchronise quand la wilaya change ET quand un token push devient
 * disponible (permission accordée via PushRegistrar, rotation) — sans ce 2ᵉ
 * déclencheur, la sync du boot (avant permission) restait sans effet jusqu'au
 * prochain démarrage. Silencieux (aucun prompt de permission).
 */
export function MarketingPush() {
  const loc = useCustomerLocation();
  const wilaya = loc?.wilaya_code ?? null;
  useEffect(() => {
    const sync = () => void syncMarketingTopic(wilaya);
    sync();
    window.addEventListener(PUSH_READY_EVENT, sync);
    return () => window.removeEventListener(PUSH_READY_EVENT, sync);
  }, [wilaya]);
  return null;
}
