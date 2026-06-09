# Super-admin — Gestion des profils livreurs (mig 0104)

Écran `/admin/drivers/[id]` : le super-admin gère le profil complet d'un livreur.

## Schéma (migration 0104)

- **`drivers`** (colonnes ajoutées) : `vehicle_type`, `vehicle_brand`,
  `vehicle_model`, `vehicle_color`, `vehicle_year`, `vehicle_plate`
  (immatriculation, existait) ; `national_id_number`, `id_card_number`,
  `date_of_birth`, `address` ; `is_verified` + `verified_at` + `verified_by` ;
  `admin_note`.
- **`driver_documents`** (1→N) : pièces d'identité — `doc_type`
  (`cni`/`permis`/`carte_grise`/`passeport`/`autre`), `number`, `issued_at`,
  `expires_at`, `file_url`, `note`. RLS : le livreur lit les siennes,
  l'écriture est réservée au super-admin (`is_super_admin()`).
- **`driver_payout_methods`** (1→N, multi-moyens) : `method`
  (`especes`/`ccp`/`baridimob`/`virement`), `account_number`, `account_name`,
  `label`, `is_default` (trigger : un seul défaut par livreur). RLS idem.

## Actions (`app/admin/drivers/actions.ts`)

`updateDriverProfile`, `setDriverVerified`, `upsert/deleteDriverDocument`,
`upsert/deleteDriverPayoutMethod`, `reassignDelivery`. Toutes gardées par
`isSuperAdmin()`, écrites via service-role, tracées dans `admin_audit_log`.

## Réattribution / retrait de commande — `admin_reassign_delivery(order, mode, driver?)`

RPC `SECURITY DEFINER` gardée par `is_super_admin()`. **Pré-retrait uniquement**
(`delivery_picked_up_at IS NULL`) pour ne pas casser la custody du cash.

- `pool` → retire au livreur, remet au **réseau** (`delivery_driver_id = NULL`),
  cooldown 10 min sur l'ancien (`express_declines`) → un AUTRE livreur la prend.
- `driver` → attribue à un **livreur précis** (non gelé) ; passe sa paire
  `driver_availability` en `busy` si elle existe chez ce commerçant.
- `cancel` → délègue à `admin_cancel_order` (remboursements + notifs).

## Gel / blocage durci

Un livreur `is_frozen` peut consulter son profil mais **ne peut ni passer en
ligne ni recevoir de course** : `set_driver_availability` et `pull_next_express`
rejettent désormais les gelés (le pull nearby le faisait déjà) ; l'action
`setGlobalAvailability` refuse le passage en ligne ; l'accueil affiche
« Compte gelé ».

## Finances par période (défaut = mois)

Lecture des snapshots immuables sur `orders` (livrées sur la période) :
gain **brut** (Σ `delivery_fee_da`), **cotisations Coligo** (Σ `driver_fee_da`,
8 %), gain **net** (Σ `driver_net_da`), cash encaissé, **à reverser**
(Σ `driver_owes_platform_da`, cash), **la plateforme lui doit** (Σ net des
commandes prépayées), **solde net** + sens. Performance (livrées/annulées tout
temps, note, inscription) + facturation (`driver_statements`).
Cf. [[project_driver_payment_model]] pour la logique financière.
