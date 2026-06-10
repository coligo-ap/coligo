"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openSupportChat } from "@/components/support/tawk-chat";

/**
 * Bouton « Contacter le support » de la page Aide commerçant. On l'affiche
 * APRÈS la FAQ : la plupart des questions y trouvent réponse, le support humain
 * reste à un tap. Contexte « commerçant » injecté pour l'agent.
 */
export function MerchantSupportCta() {
  return (
    <Button
      type="button"
      size="lg"
      className="w-full"
      onClick={() => openSupportChat({ attributes: { espace: "Commerçant" } })}
    >
      <MessageCircle className="size-4" />
      Discuter avec le support
    </Button>
  );
}
