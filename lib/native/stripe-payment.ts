"use client";

// =============================================================================
// Paiement € NATIF (APK Capacitor) — Stripe PaymentSheet via
// @capacitor-community/stripe.
// =============================================================================
// Pourquoi : dans la WebView Android, l'API Payment Request n'existe pas —
// le Payment Element web ne peut PAS afficher Google Pay/Apple Pay (limitation
// Google/Apple, pas un bug). Le SDK NATIF Stripe, lui, présente une feuille
// système avec Google Pay (Android) / Apple Pay (iOS) + formulaire carte,
// 3DS natif inclus. Même client_secret, même webhook source de vérité — seul
// le « présentateur » change.
//
// Import DYNAMIQUE uniquement quand isNative() : le bundle web n'embarque
// rien, et l'implémentation web du plugin (stripe-pwa-elements) n'est jamais
// chargée.
// =============================================================================

import { isNative, getNativePlatform } from "@/lib/native/context";

// Merchant ID Apple Pay (developer.apple.com → Identifiers → Merchant IDs,
// certificat créé via le dashboard Stripe). VIDE tant qu'il n'existe pas :
// iOS garde la feuille native carte seule, rien ne casse. À remplir avec
// « merchant.app.coligo.client » une fois créé + entitlement in-app-payments.
const APPLE_PAY_MERCHANT_ID = "";

export type NativePayResult = "paid" | "canceled" | "failed";

/** Le paiement natif est-il disponible ici ? Exige le WebView Capacitor ET
 *  le plugin Stripe DANS le binaire : un APK antérieur au plugin (le JS est
 *  servi à distance, pas le natif) retombe sur la feuille web — carte OK,
 *  wallets masqués — au lieu d'un échec. */
export function nativePaymentAvailable(): boolean {
  if (!isNative()) return false;
  const cap = (
    window as unknown as {
      Capacitor?: { isPluginAvailable?: (name: string) => boolean };
    }
  ).Capacitor;
  return cap?.isPluginAvailable?.("Stripe") === true;
}

/**
 * Présente la PaymentSheet NATIVE (Google Pay / Apple Pay / carte) pour un
 * PaymentIntent existant. Résout à la fermeture de la feuille — le webhook
 * payment_intent.succeeded reste la seule source de vérité côté serveur.
 */
export async function presentNativePaymentSheet(opts: {
  clientSecret: string;
  publishableKey: string;
}): Promise<NativePayResult> {
  try {
    const { Stripe, PaymentSheetEventsEnum } =
      await import("@capacitor-community/stripe");
    await Stripe.initialize({ publishableKey: opts.publishableKey });
    await Stripe.createPaymentSheet({
      paymentIntentClientSecret: opts.clientSecret,
      merchantDisplayName: "Coligo",
      // Google Pay (Android) : environnement de test si clé pk_test_.
      enableGooglePay: getNativePlatform() === "android",
      GooglePayIsTesting: opts.publishableKey.startsWith("pk_test_"),
      // Apple Pay (iOS) : activé SEULEMENT quand le Merchant ID Apple existe
      // (developer.apple.com → Identifiers → Merchant IDs + certificat de
      // traitement créé depuis le dashboard Stripe, puis entitlement
      // in-app-payments). Vide = feuille native carte seule sur iOS — les
      // builds Codemagic ne cassent pas en attendant.
      enableApplePay:
        getNativePlatform() === "ios" && APPLE_PAY_MERCHANT_ID.length > 0,
      ...(APPLE_PAY_MERCHANT_ID
        ? { applePayMerchantId: APPLE_PAY_MERCHANT_ID }
        : {}),
      countryCode: "FR",
    });
    const { paymentResult } = await Stripe.presentPaymentSheet();
    if (paymentResult === PaymentSheetEventsEnum.Completed) return "paid";
    if (paymentResult === PaymentSheetEventsEnum.Canceled) return "canceled";
    return "failed";
  } catch (e) {
    console.error("[stripe-native] payment sheet failed:", e);
    return "failed";
  }
}
