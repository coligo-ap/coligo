"use client";

import { createContext, useContext, useEffect } from "react";
import type { ChauffeurGate } from "@/app/(chauffeur)/actions";
import {
  getChauffeurOnlineLocal,
  setChauffeurOnlineLocal,
} from "@/lib/chauffeur/online-store";
import { getHomeDirOn, setHomeDirOn } from "@/lib/chauffeur/home-dir-store";

/**
 * Contexte du GATE chauffeur (statut/profil : vérifié, gelé, dossier soumis,
 * gamme, avatar…). Le gate est résolu UNE SEULE FOIS côté serveur dans la coque
 * persistante `(app)` (cf. `ChauffeurGateGuard`) puis exposé ici. Les pages le
 * lisent en client → AUCUN aller-retour serveur à chaque changement d'onglet
 * (fin du « loading complet de chaque page »). La sécurité réelle reste serveur
 * (RLS + RPC) : ce contexte ne sert qu'au routage/affichage.
 */
const Ctx = createContext<ChauffeurGate | null>(null);

export function ChauffeurGateProvider({
  gate,
  children,
}: {
  gate: ChauffeurGate;
  children: React.ReactNode;
}) {
  // PERSISTANCE de l'intention « en ligne » : la présence SERVEUR
  // (gate.isOnline) est la source de vérité durable, indépendante du
  // localStorage du navigateur. On la réhydrate au montage de la coque
  // authentifiée (donc sur N'IMPORTE quelle page, y compris un deep-link vers
  // /chauffeur/demandes depuis une notification). Effet : un chauffeur dont le
  // cache a été vidé (réinstall APK, nouvel appareil) ne réapparaît plus « hors
  // ligne » à tort — il reste à l'écoute et continue de recevoir les demandes.
  // Le serveur n'envoyant de push qu'aux chauffeurs présents+en ligne, taper la
  // notif ramène donc toujours sur une liste qui poll réellement.
  useEffect(() => {
    if (getChauffeurOnlineLocal() !== gate.isOnline) {
      setChauffeurOnlineLocal(gate.isOnline);
    }
    // MÊME principe pour « Je rentre chez moi » : le serveur (home_dir_active)
    // est la source de vérité. Sans ça, en arrivant DIRECTEMENT sur
    // /chauffeur/demandes (deep-link notification) — donc sans passer par
    // l'accueil qui réalignait —, un ancien « 1 » en localStorage gardait le
    // filtre actif et MASQUAIT toutes les courses (ex. domicile en Algérie,
    // courses ailleurs) → liste vide alors que le serveur renvoie bien la course.
    if (getHomeDirOn() !== gate.homeDirActive) {
      setHomeDirOn(gate.homeDirActive);
    }
    // Réhydratation au montage de la coque uniquement (1 fois par chargement).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Ctx.Provider value={gate}>{children}</Ctx.Provider>;
}

export function useChauffeurGate(): ChauffeurGate {
  const gate = useContext(Ctx);
  if (!gate) {
    throw new Error(
      "useChauffeurGate doit être utilisé sous ChauffeurGateProvider"
    );
  }
  return gate;
}
