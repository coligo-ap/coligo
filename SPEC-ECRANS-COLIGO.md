# Coligo — Spécification des écrans (maquettes à suivre)

Ce document décrit chaque écran à construire, avec sa structure responsive
(mobile / tablette / desktop). Style : violet `#5C5CE0`, cartes blanches, coins
arrondis 12-16px, espace blanc généreux (inspiré du kit e-commerce fourni).

---

## CÔTÉ COMMERÇANT

### 1. Catalogue produits — `/catalog`

**Mobile :**

- Header sticky : titre "Catalogue" + bouton "+" violet (nouveau produit).
- Barre de recherche.
- Chips de catégories (scroll horizontal).
- Liste verticale de cartes produit : image (gauche), nom + prix + unité (centre),
  toggle disponibilité (droite).
- Bottom-nav.

**Tablette :** grille 2 colonnes de cartes produit.

**Desktop :**

- Sidebar fixe gauche (navigation commerçant).
- Header : titre + recherche + bouton "Nouveau produit".
- Filtres en ligne (catégorie, statut).
- Grille 3 colonnes de cartes produit, plus denses, avec actions au survol.

**Carte produit :** image carrée (ratio 1:1), nom en gras, catégorie en petit gris,
prix en violet gras, unité, badge "Disponible/Épuisé", toggle.

---

### 2. Formulaire produit — `/catalog/new` et `/catalog/[id]`

**Structure (toutes tailles, largeur max centrée sur desktop) :**

- Section "Informations" avec onglets FR / AR :
  - Nom du produit (FR puis AR)
  - Description (FR puis AR)
- Section "Prix & stock" :
  - Prix (DA), Unité (select: pièce/kg/litre/mètre/custom), Catégorie (select)
  - Toggle "Disponible"
- Section "Photo" : zone d'upload (drag & drop) + aperçu, jusqu'à 1-4 images.
- Barre d'actions sticky en bas : Annuler / Enregistrer.

**Desktop :** 2 colonnes (infos + photo à gauche, prix/stock à droite).

---

### 3. Détail commande — `/orders/[id]`

**Structure :**

- En-tête : numéro commande, badge statut, heure de retrait.
- Timeline verticale des statuts (confirmée → acceptée → préparation → prête →
  récupérée), l'étape courante mise en avant en violet.
- Carte client : nom, téléphone, bouton appeler.
- Liste des items : image, nom, quantité, prix ligne.
- Récap : sous-total, frais, cashback, total. + part commission Coligo.
- Carte "Retrait" : code 6 chiffres en gros + heure du créneau.
- Actions selon statut : Accepter / Refuser, puis En préparation, puis Prête.

**Desktop :** 2 colonnes (items + timeline à gauche, client + actions à droite).

---

### 4. Validation retrait — `/orders/validate`

- Deux onglets : "Code 6 chiffres" / "Scanner QR".
- Onglet code : 6 cases de saisie + pavé numérique (mobile).
- Onglet QR : zone caméra avec cadre de scan animé (@zxing/browser).
- Bouton "Valider la remise" → passe la commande en "Récupérée".

---

## CÔTÉ CLIENT (MARKETPLACE)

### 5. Accueil — `/`

**Mobile :**

- Header compact : localisation (wilaya/commune) cliquable + icône notif.
- Barre de recherche sticky.
- Bannière promo (carrousel).
- Catégories en scroll horizontal (icônes rondes + label).
- "Commerces près de vous" : liste verticale de cartes commerce.
- Bottom-nav (Accueil / Recherche / Panier / Commandes / Profil).

**Tablette :** 2 colonnes de cartes commerce, catégories en grille.

**Desktop :**

- **Header complet** : logo, barre de recherche centrale large, sélecteur de
  wilaya, lien "Devenir commerçant", icône panier, menu compte.
- Bannière hero large.
- Catégories en ligne (8-10 visibles).
- Grille 3-4 colonnes de cartes commerce.
- **Footer riche** : colonnes (À propos, Catégories, Aide, Légal), réseaux,
  sélecteur de langue FR/AR.

**Carte commerce :** image cover (16:9), logo rond, nom, catégorie, note (étoiles),
distance, badge "Ouvert/Fermé", éventuellement badge promo.

---

### 6. Recherche — `/search`

**Mobile :**

- Barre de recherche en haut + bouton "Filtres" (ouvre un sheet slide-up).
- Sheet filtres : wilaya, commune, catégorie, "ouvert maintenant", note min, tri.
- Résultats en liste verticale.

**Desktop :**

- Barre de recherche en header.
- **Sidebar filtres à gauche** (toujours visible) : wilaya, commune, catégorie
  (cases à cocher), note, ouvert, tri.
- Grille 3 colonnes de résultats à droite.
- Compteur de résultats + tri en haut de la grille.

Recherche par : nom de commerce, catégorie, spécialité.

---

### 7. Fiche commerçant — `/m/[slug]`

**Mobile :**

- Cover en haut + bouton retour + favori/partage.
- Carte infos qui chevauche la cover : logo, nom, note, badge ouvert.
- Stats : temps de préparation, min commande, % cashback.
- Onglets de catégories (scroll horizontal).
- Liste de produits groupés par catégorie (carte = image, nom, prix, bouton +).
- **Panier flottant** en bas (nombre d'articles + total + "Voir le panier").

**Desktop :**

- Cover large.
- 2 colonnes : catalogue produits (gauche, grille 2-3 col) + **panier sticky**
  (droite) qui reste visible au scroll.

---

### 8. Panier — `/cart`

- Items groupés par commerce.
- Par commerce : créneau de retrait choisi (modifiable), liste d'items avec
  quantités ajustables, sous-total.
- Si pas de créneau choisi : alerte "Choisir un créneau".
- Récap global : sous-total, frais service, promo, total.
- Barre d'action : total + "Commander".

**Desktop :** 2 colonnes (items à gauche, récap sticky à droite).

---

### 9. Checkout — `/checkout`

- Sélection des créneaux de retrait par commerce (grille d'horaires, capacité).
- Toggle "Utiliser mon cashback" (montant dispo).
- Champ code promo.
- Récap final : sous-total, frais, promo, cashback utilisé, total à payer.
- Bouton "Confirmer la commande".
- Après confirmation → écran de succès avec le code de retrait 6 chiffres + QR.

**Desktop :** 2 colonnes (créneaux + options à gauche, récap sticky à droite).

---

### 10. Suivi commande client — `/orders/[id]`

- Carte statut en gros (avec icône selon état).
- **Code de retrait 6 chiffres en grand + QR code** (pour montrer au commerçant).
- Timeline de progression (mise à jour en Realtime).
- Détails : commerce, adresse, créneau, items, total.
- Bouton appeler le commerce.

---

## RÈGLES TRANSVERSES

- **Tous les prix en DA** (Dinars Algériens), format "1 250 DA".
- **Tous les textes de contenu** (noms produits, descriptions) ont une version
  FR et AR en base ; l'UI affiche le FR pour le MVP.
- **États vides** : chaque liste a un état vide soigné (icône + message + action).
- **États de chargement** : skeletons ou spinners pendant les fetch.
- **Touch targets** : minimum 44px sur mobile.
- **Le panier** est persistant (localStorage côté client OU table `carts` en base).

---

## RÉFÉRENCES VISUELLES (recommandation)

**Approche recommandée : une seule charte visuelle claire, pas de sources qui se
contredisent.**

1. **Charte visuelle = le kit e-commerce violet** (fichier `3971.jpg`). C'est LA
   référence pour les couleurs, boutons, cartes, ratings, espacements, et la
   structure des écrans produit / panier / checkout. Place ce fichier dans le
   dossier du projet pour l'avoir sous les yeux.

2. **Structure des écrans = ce document (`SPEC-ECRANS-COLIGO.md`)**. Il décrit
   précisément le layout responsive de chaque écran (mobile/tablette/desktop),
   ce qui est plus actionnable pour du code qu'une image.

**NE PAS utiliser les anciennes maquettes HTML originales** comme référence : si
elles divergent du style violet, elles créeront des incohérences. Une seule
direction visuelle (le kit violet) = un résultat cohérent.

Pour tout ce qui est spécifique à l'Algérie et absent du kit (wilayas, cashback,
créneaux de retrait, code 6 chiffres, kanban commandes) : suis la description de
ce document, en gardant le style violet du kit pour l'apparence.
