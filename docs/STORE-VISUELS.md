# Visuels stores Coligo — panorama 7 volets

Direction artistique + **prompts prêts à coller** dans un générateur d'images
(Midjourney, Firefly, DALL·E, Imagen…), pensés pour un panorama unique découpé
en 7 captures. À l'arrivée, chaque volet se lit seul **et** l'ensemble se lit
comme une seule image large quand on fait défiler la fiche du store.

---

## 1. Format et contraintes techniques

| Store                                | Dimension par volet | Notes             |
| ------------------------------------ | ------------------- | ----------------- |
| App Store (6.9" / iPhone 17 Pro Max) | **1320 × 2868 px**  | jeu obligatoire   |
| App Store (6.7")                     | 1290 × 2796 px      | rétro-compatible  |
| Google Play                          | **1080 × 1920 px**  | min 320, max 3840 |

Panorama complet à composer **avant** découpe : `9 240 × 2 868 px`
(7 × 1 320) pour l'App Store. On dessine le fond en une seule pièce, puis on
découpe — c'est ce qui donne l'effet « une seule photo coupée ».

**Zone de sécurité** : ne rien placer d'important dans les 140 px du haut ni
les 160 px du bas — les stores y superposent leur interface.

---

## 2. Charte

- **Violet Coligo** `#6C2BD9` (principal) · `#4B1FA6` (profond) · `#8A4DFF`
  (clair) · **rose accent** `#FF2D7A`.
- Dégradé de fond **continu sur les 7 volets** : violet profond à gauche →
  violet clair au centre → rose sourd à droite. C'est lui qui « recolle » les
  images.
- Typo : **Sora** (titres, extrabold) + **Plus Jakarta Sans** (sous-titres).
- Aucune ombre portée lourde, aucun effet 3D : à plat, net, premium.
- Nom arabe de la marque : **كوليغو** (jamais كوليقو / كوليڨو).

---

## 3. Les 7 volets

Le titre court est en haut, la personne ou le téléphone en bas. Un mot de
chaque titre est **coupé au bord** et repris au début du volet suivant : c'est
la signature du panorama.

### Volet 1 — Ouverture, sans capture

> **Titre** : « Tout Coligo, dans votre poche. »
> **Sous-titre** : « Courses, repas, trajets et paiement — une seule app. »
> **AR** : « كل كوليغو في جيبك » · « تسوّق، وجبات، تنقّل ودفع — تطبيق واحد »

**Prompt image**

```
Photographie éditoriale premium, femme algérienne d'une trentaine d'années,
type maghrébin d'Afrique du Nord, cheveux bouclés bruns attachés, veste en jean
moderne sur t-shirt blanc, sourire naturel et discret, regard vers l'objectif,
debout dans une rue commerçante ensoleillée de Béjaïa en fin d'après-midi,
arrière-plan volontairement flou (bokeh doux), lumière chaude rasante venant de
la droite, tenant un smartphone sans le regarder. Cadrage vertical, sujet
décalé à droite du cadre, deux tiers de l'image vides à gauche pour le texte.
Rendu photo réaliste 85 mm f/1.8, grain fin, couleurs chaudes et saturation
maîtrisée. Aucun logo de marque visible.
```

### Volet 2 — Capture Drive : saisie du trajet

> **Titre** : « Béjaïa → Alger, en trois taps. »
> **Sous-titre** : « Prix connu d'avance. Aucune surprise. »
> **AR** : « بجاية ← الجزائر في ثلاث نقرات » · « السعر معروف مسبقًا »

**Capture à utiliser** : accueil Drive, champ de trajet rempli
« Béjaïa » → « Alger », suggestions ouvertes, badge inter-wilayas visible.
Placer la capture dans un cadre iPhone 17 Pro (bords titane, encoche
dynamique), légèrement incliné (‑6°), débordant du bas du volet.

### Volet 3 — Capture Drive : choix de gamme

> **Titre** : « Choisissez votre confort. »
> **Sous-titre** : « Économique, Confort ou Van — le prix s'affiche avant. »
> **AR** : « اختر راحتك » · « اقتصادي، مريح أو فان — السعر قبل الحجز »

**Capture** : feuille de choix de gamme avec les cartes de véhicules et
l'itinéraire tracé sur la carte derrière. Même cadre iPhone, incliné de
**+6°** (miroir du volet 2 : les deux téléphones se « regardent »).

### Volet 4 — Passager satisfait, sans capture

> **Titre** : « Livré. Comme prévu. »
> **Sous-titre** : « Suivi en direct, du commerçant à votre porte. »
> **AR** : « وصل. كما وُعد » · « تتبّع مباشر من المحل إلى بابك »

**Prompt image**

```
Photographie éditoriale premium, jeune homme algérien kabyle d'environ 28 ans,
peau claire mate, barbe courte soignée, pull côtelé beige, assis sur les
marches d'un immeuble moderne d'Alger, regardant son smartphone avec un sourire
de satisfaction sincère, un sac de courses en papier posé à côté de lui.
Lumière naturelle de fin de journée, ombres douces, arrière-plan urbain flou
aux tons chauds. Cadrage vertical, sujet dans le tiers inférieur droit, espace
libre en haut à gauche pour le texte. Photo réaliste 50 mm f/2, grain fin.
Aucun logo visible sur les vêtements ni sur le sac.
```

### Volet 5 — Capture commerçant : catégories d'une supérette

> **Titre** : « Votre supérette, rayon par rayon. »
> **Sous-titre** : « Des milliers de produits, retrait ou livraison. »
> **AR** : « متجرك، رفًّا رفًّا » · « آلاف المنتجات، استلام أو توصيل »

**Capture** : fiche d'une supérette ouverte sur la section **catégories**,
avec les vignettes de rayons et un carrousel de produits en promotion.

### Volet 6 — Livreur en course

> **Titre** : « Une course arrive. »
> **Sous-titre** : « Distance, gain et adresse : tout est dit avant d'accepter. »
> **AR** : « طلب جديد وصل » · « المسافة والربح والعنوان — كل شيء قبل القبول »

**Prompt image + capture combinés**

```
Photographie éditoriale premium, livreur algérien d'environ 30 ans, casque de
scooter tenu sous le bras, veste coupe-vent violet foncé unie sans marque,
debout à côté d'un scooter dans une rue d'Alger au petit matin, regardant son
smartphone avec attention et un léger sourire. Lumière matinale douce et
bleutée, arrière-plan urbain flou. Cadrage vertical, sujet à gauche, espace
libre à droite pour incruster une capture d'écran de téléphone. Photo réaliste
85 mm f/2, grain fin. Aucun logo de marque visible.
```

**Capture à incruster** : écran livreur de **réception d'une course** —
distance, gain, adresse, minuteur d'acceptation.

### Volet 7 — Clôture, appel à l'action

> **Titre** : « Rejoignez Coligo. »
> **Sous-titre** : « Client, commerçant, livreur ou chauffeur — votre place vous attend. »
> **AR** : « انضم إلى كوليغو » · « زبون، تاجر، موصّل أو سائق — مكانك بانتظارك »

**Prompt image**

```
Photographie éditoriale premium de groupe, trois personnes algériennes côte à
côte, plan taille : une commerçante d'une quarantaine d'années en blouse de
travail sobre devant son étal, un chauffeur d'une trentaine d'années en chemise
propre, une cliente jeune tenant un sac de courses. Traits maghrébins d'Afrique
du Nord, expressions naturelles et confiantes, sourires retenus. Studio en
lumière douce, fond uni neutre pour détourage facile. Cadrage vertical, groupe
centré dans le tiers inférieur. Photo réaliste 70 mm f/4, netteté homogène sur
les trois visages. Aucun logo de marque visible.
```

---

## 4. Continuité du panorama

Trois éléments traversent les 7 volets et doivent être dessinés **sur l'image
large avant découpe** :

1. **le dégradé de fond** (violet profond → violet clair → rose sourd) ;
2. **une ligne de trajet fine** en blanc à 30 % d'opacité, qui serpente d'un
   bord à l'autre comme un itinéraire, passant derrière les téléphones ;
3. **des halos flous** violets et roses, coupés net aux jonctions.

Vérification finale : poser les 7 volets côte à côte à 25 % de zoom. Si une
jonction se voit, c'est que l'élément n'a pas été dessiné en pleine largeur.

---

## 5. Ce qui reste à faire, et par qui

| Étape                                         | Qui                                               |
| --------------------------------------------- | ------------------------------------------------- |
| Générer les 4 photos (volets 1, 4, 6, 7)      | générateur d'images ou photographe                |
| Capturer les 4 écrans de l'app en 1320 × 2868 | **je peux le faire** sur la production            |
| Composer le panorama + découpe en 7           | **je peux le faire** en HTML/CSS puis export      |
| Intégrer les photos dans le montage           | **je peux le faire** une fois les photos fournies |

> Les photos de personnes ne peuvent pas être produites depuis cet outil.
> Les prompts ci-dessus sont calibrés pour être collés tels quels dans un
> générateur, ou remis à un photographe comme brief de casting et de cadrage.
