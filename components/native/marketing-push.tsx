"use client";

import { useEffect } from "react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { syncMarketingTopic } from "@/lib/native/marketing-topics";

/**
 * Abonne l'appareil au topic MARKETING de sa wilaya (promos de commerçants
 * proches), INDÉPENDAMMENT de la connexion → un utilisateur DÉCONNECTÉ continue
 * de recevoir les promos de sa zone, tandis que le personnel (adressé par token/
 * user_id) est coupé au logout. Monté SANS condition d'auth dans la coque client.
 * Re-synchronise quand la wilaya change. Silencieux (aucun prompt de permission).
 */
export function MarketingPush() {
  const loc = useCustomerLocation();
  useEffect(() => {
    void syncMarketingTopic(loc?.wilaya_code ?? null);
  }, [loc?.wilaya_code]);
  return null;
}
