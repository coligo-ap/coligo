# Roadmap pré-lancement public — Coligo

> **Statut : à RÉALISER AVANT le lancement public.** Ce document est une feuille
> de route — **rien ici n'est implémenté**. Il liste les chantiers nécessaires
> avant ouverture au public (paiement réel + sécurité niveau bancaire).

---

## 1. CCP réel (paiement / versements)

Brancher le **compte CCP réel** de l'entité Coligo avant le lancement public.

- Aujourd'hui les CCP/RIB de versement plateforme sont des **placeholders**
  (`000 000 000 · clé 00`), saisissables via `/admin/recharges` et par module
  (driver / chauffeur / merchant / partner) — cf. `platform_payment_accounts`
  (mig 0200) et `operator_topup_config()`.
- **À faire** : renseigner les vrais numéros CCP + RIB par module une fois le
  compte bancaire/CCP de l'entité ouvert. Vérifier le rapprochement avec les
  flux Chargily (paiement en ligne) et les versements opérateur.
- Dépendance amont : création de l'entité légale DZ (cf. [[OTP WhatsApp]] /
  vérification d'entreprise) — le compte CCP en découle.

---

## 2. Chantier sécurité (post-lancement, cible « niveau bancaire »)

Objectif : robustesse type établissement financier (ex. Société Générale) —
**architecture sécurité multicouche**, détection avancée, blocage automatique
des comportements anormaux. À étaler par lots après le lancement.

### 2.1 Protection infrastructure (DDoS / bots / automatisation)

- Protection **DDoS** (edge / CDN — ex. Cloudflare devant Vercel).
- Détection et blocage des **bots** et de l'**automatisation malveillante**
  (challenge, rate-limit edge, fingerprint).

### 2.2 Anti-abus

- **Spam** (messages, formulaires, signalements).
- **Créations massives de comptes** (même appareil/IP, e-mails jetables,
  numéros recyclés) — s'appuyer sur le traçage appareils/IP existant
  (`user_device_log`, `/admin/devices`).
- **Inondation de requêtes** (rate-limiting par utilisateur / IP / route).
- **Scraping** du catalogue, des prix, des chauffeurs.

### 2.3 Détection de comportements frauduleux

- **Recherches d'adresses anormalement nombreuses** (geocode / gazetteer)
  → quotas + scoring.
- **Actions répétitives** anormales (annulations en série, no-shows, refus en
  boucle, allers-retours de toggle).
- **Activité suspecte** transverse (corrélation appareil/IP/compte).

### 2.4 Sécurité par rôle (tous les espaces)

Revue de cloisonnement **client / commerçant / livreur / chauffeur / admin** :
confirmer que chaque espace applique auth + RLS + isolation de rôle
(cf. isolation des rôles déjà en place) et durcir les points faibles.

### 2.5 Couches supplémentaires Coligo Pay (opérations sensibles)

- **Validation renforcée des transactions** (limites, double-contrôle,
  step-up auth sur opérations sensibles).
- **Détection de fraude en temps réel** + **scoring** des opérations.
- **Limitation des risques** (plafonds dynamiques, vélocité, listes de
  surveillance) + **surveillance continue** (alertes, journaux d'audit).
- S'appuyer sur le grand livre inviolable + idempotence + double-entrée SUM=0
  déjà en place ; AJOUTER la couche détection/scoring au-dessus.

### Cible

Architecture **sécurité multicouche** + **détection avancée** + **blocage
automatique** des comportements anormaux — robustesse de niveau bancaire.

---

_Document de cadrage uniquement. Aucune de ces tâches n'est codée à ce stade._
