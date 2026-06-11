# CHECKLIST DRIVE — 100 % OBLIGATOIRE, AUCUNE OMISSION

> Claude Code : tu dois implémenter **CHAQUE** item ci-dessous, dans la maquette il est DÉJÀ visible.
> Interdiction de considérer le travail terminé tant que tous les items ne sont pas cochés.
> À la fin, produis `RAPPORT-CONFORMITE.md` : pour chaque item → ✅ + fichier/composant qui l'implémente.
> Un item non implémenté = livraison refusée.

## A. CLIENT — Trajet & accueil Drive

- [x] A1. Onglet **Drive** (icône voiture) dans la nav Coligo : Accueil · Commandes · Drive · Pay · Compte
- [x] A2. Départ par défaut = **« Ma position actuelle »** (GPS)
- [x] A3. Départ modifiable via **carte à épingle centrale** (carte qu'on déplace, adresse mise à jour, « Confirmer ce point »)
- [x] A4. Destination via la même carte à épingle + destinations récentes
- [x] A5. Bouton **« Historique »** en haut de l'accueil Drive
- [x] A6. Page Historique avec 2 onglets : **Courses** (terminées/annulées) et **♥ Favoris**
- [x] A7. Favoris : liste des chauffeurs favoris, cœur pour retirer

## B. CLIENT — Gamme, paiement, options (écran prix)

- [x] B1. **Cards carrées horizontales défilables** : Classic (défaut, sélectionnée) · Confort · Moto, avec les **photos détourées** de la maquette
- [x] B2. Chaque card affiche UNIQUEMENT « {prix} DA · recommandé » — moto la moins chère
- [x] B3. **Moyen de paiement sur CET écran** : Espèces (défaut) · Carte · Coligo Pay — l'écran de fin n'a AUCUN sélecteur
- [x] B4. Prix pré-rempli au recommandé, ajustable −/+ (pas de 20 DA), libellés « En dessous/Au-dessus du recommandé »
- [x] B5. **AUCUN affichage** de « prix bas », « rapide », ni de la majoration nuit 22h–6h (+≤20 % UNIQUEMENT dans l'algorithme)
- [x] B6. Fourchette « Courses similaires : X–Y DA »
- [x] B7. **Booster en VERT** : ligne verte + toggle vert + montant ajustable, libellé « prioritaire, plus rapide »
- [x] B8. **« Femme au volant » en ROSE** : icône fond rose, titre rose, **toggle rose**, texte de disponibilité (« N conductrices en ligne »)
- [x] B9. **« Pour un proche »** : choix du contact, départ = position du proche, suivi envoyé par SMS/WhatsApp sans compte, numéro masqué

## C. CLIENT — Recherche & offres

- [x] C1. Diffusion de l'offre, chauffeurs **acceptent ou contre-proposent**
- [x] C2. Tri des offres : **« Moins chers » / « Mieux notés »** + badges « Le moins cher » / « Mieux noté »
- [x] C3. **♥ Favoris en tête de liste** avec badge « ♥ Favori », cœur cliquable sur chaque offre
- [x] C4. Chip verte **« ⚡ Boostée »** sur la recherche quand le boost est actif + bouton « Boostez » relançable
- [x] C5. **Filtre conductrice actif → offres des conductrices stylées ROSE** (carte, avatar, nom roses + badge « Conductrice »)
- [x] C6. **Aucune conductrice en ligne → bandeau d'explication + chauffeurs hommes stylés en NOIR** (avatar + nom noirs) + notification promise quand une conductrice se connecte
- [x] C7. Annuler la recherche : gratuit, motif demandé
- [x] C8. **Mode hors-ligne** : demande mise en file (Dexie), bannière « Hors connexion — demande enregistrée », envoi auto au retour réseau

## D. CLIENT — Course active & SÉCURITÉ (souvent oublié — NE PAS SAUTER)

- [x] D1. Carte chauffeur v3 : avatar rond + **badge vérifié**, chips « ★ note » + « N courses », **bandeau véhicule + PLAQUE façon vraie plaque**, boutons **Message / Appeler** pleine largeur
- [x] D2. **« Partager mon trajet »** : modale avec fiche chauffeur + plaque + lien public `coligo.app/t/{token}`, envoi **WhatsApp** et **SMS** en un tap, suivi en direct SANS compte
- [x] D3. **Bouton SOS rouge** sur la course : modale avec 3 actions — **Appeler le 17** · **Alerter mes contacts d'urgence** · **Alerter le support Coligo** — position + course jointes automatiquement
- [x] D4. **Détection d'itinéraire anormal** : carte ambre « Tout va bien ? » (déviation vs route prévue) avec boutons [Tout va bien] et [SOS → ouvre la MÊME modale SOS]
- [x] D5. Badge rose **« Course pour {proche} · suivi envoyé sur son téléphone »** quand l'option proche est active
- [x] D6. Annulation course : gratuite, motifs, message « chauffeur déjà en route, évitez le dernier moment »
- [x] D7. Messages rapides in-app, numéros masqués

## E. CLIENT — Fin de course

- [x] E1. Récap : prix convenu, libellé selon paiement choisi en B3, commission « incluse »
- [x] E2. **Cashback croisé** affiché (« utilisable sur Drive ET vos livraisons Coligo »)
- [x] E3. Notation 5★ + **« Signaler un problème »** : motifs précis (conduite dangereuse, remarques déplacées, itinéraire anormal, véhicule non conforme/plaque différente, paiement hors app) → confirmation « examen sous 24 h, suspension possible, vous serez informée »

## F. CHAUFFEUR — Onboarding & états de compte

- [x] F1. Connexion (téléphone + mot de passe) / **Inscription** : nom, prénom, téléphone, date de naissance, wilaya, mot de passe, **gamme du véhicule**
- [x] F2. Documents : **Permis OBLIGATOIRE**, **Carte grise OBLIGATOIRE**, **Immatriculation OBLIGATOIRE**, Assurance optionnelle
- [x] F3. **Selfie EN DIRECT uniquement** (caméra, import de fichier INTERDIT), visage neutre
- [x] F4. Envoi dossier → écran d'attente à étapes ; **accès au compte BLOQUÉ tant qu'un SUPER ADMIN n'a pas validé**
- [x] F5. États : pending / active / **frozen** — écran « Compte gelé » avec les 4 motifs (impayé plateforme, annulations répétées, comportement signalé, note trop basse), seuils en config admin

## G. CHAUFFEUR — Accueil & demandes

- [x] G1. **Heatmap** zones de demande + légende ; **feuille réductible** (tap) pour voir la carte
- [x] G2. **Gains du jour** (montant + courses + heures)
- [x] G3. Bandeau gamme : « Votre gamme : Confort — vous recevez **Classic + Confort** » (Classic ne reçoit QUE Classic ; Moto ↔ Moto)
- [x] G4. **« Je rentre chez moi · {adresse} »** : toggle + **adresse MODIFIABLE** (crayon, aussi depuis Compte, synchronisée) → ne reçoit que les courses vers cette direction
- [x] G5. Liste demandes : tri Proches/Mieux payées, **boostées en premier (bordure + badge VERT ⚡)**
- [x] G6. **Badge violet « Confort demandé »** quand le client a choisi Confort
- [x] G7. Chaque demande : 2 distances (Vous→client, Client→destination) + ancienneté + note client
- [x] G8. **« Voir le trajet sur la carte »** : écran avec approche en **GRIS POINTILLÉ + étiquette « X km · approche »**, course en **VIOLET + étiquette « Y km · course »**, marqueurs voiture/client/drapeau
- [x] G9. Ajuster son prix −/+ puis **Proposer X** ou **Accepter** ; anti **double-engagement** (1 course max, autres propositions annulées) + TTL

## H. CHAUFFEUR — Course

- [x] H1. « {client} a accepté ! » → prise en charge (fiche client, « Je suis arrivé », annulation motifs + règle 5 min client absent)
- [x] H2. **SOS chauffeur** sur la course en cours (même modale 3 actions)
- [x] H3. **Back-to-back** : proposition de course proche du POINT DE DÉPOSE pendant la course (minuteur 12 s), file de 1, retirable, bouton « Enchaîner » à la fin
- [x] H4. Fin : prix, commission selon plan, **gain net**, upsell « Avec Premium (0 %) vous auriez gardé X »

## I. CHAUFFEUR — Gains, abonnements, pages

- [x] I1. Nav chauffeur 4 onglets TOUS fonctionnels : Accueil · Drive · **Gains** · **Compte** (+ Historique depuis Gains)
- [x] I2. Gains « Ce mois » : brut, commission, abonnement, **net**, encadré « **À reverser à Coligo** » selon plan
- [x] I3. Plans : **Gratuit 8 %** · **Pro 1 500 DA/mois 3,5 %** · **Premium 3 900 DA/mois 0 % + priorité dispatch + badge 👑**
- [x] I4. **Paiement abonnement** : modale **CCP** (numéro plateforme + clé + référence + « J'ai payé · envoyer le reçu » → vérification 24 h) OU **carte en ligne** (immédiat)
- [x] I5. **Dates + recouvrement** : « Actif jusqu'au {date} · renouvelez avant le {date+5}, sinon **retour automatique au plan Gratuit** » + job d'échéance
- [x] I6. Historique chauffeur (gamme/boost/net par course) ; Compte : profil + **badge Premium**, véhicule + gamme, domicile modifiable, documents, langue

## J. Transverse

- [x] J1. Thème clair/sombre identique à la maquette ; violet #5B5BE6, vert boost #16B364, **rose conductrice #EC4899**, or Premium
- [x] J2. FR/AR + RTL (next-intl) ; aucune valeur financière en dur (config admin) ; `client_operation_id` partout ; événements dans `ride_events`
- [x] J3. Tous les seuils (gel, dette, annulations, note) configurables côté admin
