/**
 * Catalogue des messages prédéfinis du chat in-app client ↔ livreur.
 *
 * Pas de texte libre : chaque message est un CODE stable stocké en base
 * (`order_messages.code`) et rendu/localisé ici (FR/AR). Ainsi un message
 * envoyé en français s'affiche en arabe pour un destinataire en arabe, et la
 * traduction reste centralisée.
 */

export type ChatRole = "customer" | "courier";
export type ChatLocale = "fr" | "ar";

export type QuickMessage = {
  code: string;
  fr: string;
  ar: string;
};

/** Messages que le CLIENT peut envoyer à son livreur. */
export const CUSTOMER_QUICK: QuickMessage[] = [
  { code: "where_are_you", fr: "Vous êtes où ?", ar: "أين أنت؟" },
  { code: "coming_down", fr: "Je descends", ar: "أنا نازل" },
  {
    code: "leave_at_door",
    fr: "Laissez devant la porte",
    ar: "اتركها أمام الباب",
  },
  { code: "call_me", fr: "Appelez-moi svp", ar: "اتصل بي من فضلك" },
  { code: "thanks", fr: "Merci !", ar: "شكراً!" },
];

/** Messages que le LIVREUR peut envoyer au client. */
export const COURIER_QUICK: QuickMessage[] = [
  { code: "on_my_way", fr: "J'arrive", ar: "أنا في الطريق" },
  { code: "im_here", fr: "Je suis en bas", ar: "أنا في الأسفل" },
  { code: "few_min", fr: "5 min et j'arrive", ar: "5 دقائق وأصل" },
  { code: "cant_find", fr: "Je ne trouve pas l'adresse", ar: "لا أجد العنوان" },
  { code: "call_me", fr: "Appelez-moi svp", ar: "اتصل بي من فضلك" },
];

const ALL: QuickMessage[] = [...CUSTOMER_QUICK, ...COURIER_QUICK];

/** Boutons de réponse rapide proposés pour un rôle donné. */
export function quickFor(role: ChatRole): QuickMessage[] {
  return role === "customer" ? CUSTOMER_QUICK : COURIER_QUICK;
}

/** Libellé localisé d'un code (repli : le code brut si inconnu). */
export function labelFor(code: string, locale: ChatLocale = "fr"): string {
  const m = ALL.find((x) => x.code === code);
  if (!m) return code;
  return locale === "ar" ? m.ar : m.fr;
}
