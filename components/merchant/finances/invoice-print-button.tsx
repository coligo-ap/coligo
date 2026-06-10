"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * « Télécharger / Imprimer (PDF) » — déclenche la boîte d'impression du
 * navigateur, qui propose « Enregistrer au format PDF ». Aucune dépendance PDF.
 */
export function InvoicePrintButton() {
  return (
    <Button type="button" onClick={() => window.print()} size="lg">
      <Download className="size-4" />
      Télécharger / Imprimer (PDF)
    </Button>
  );
}
