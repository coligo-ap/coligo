# Animations Lottie — sources

Micro-illustrations du bandeau « commandes en cours » (client). Fichiers
téléchargés depuis LottieFiles (animations publiques, Lottie Simple License —
usage commercial autorisé). Servis en LOCAL (aucun CDN) pour rester
offline-safe dans l'APK.

| Fichier          | Scène                   | Source (LottieFiles, assets-v2)                        |
| ---------------- | ----------------------- | ------------------------------------------------------ |
| `pending.json`   | Reçu / commande envoyée | a/0973a122-478b-11f0-a1f8-6b0ec158df9f/R5KkucskAG.json |
| `preparing.json` | Cuisine / préparation   | a/e2afb4d0-1150-11ee-9d63-53bcb503ebf8/HQEBKBBbTg.json |
| `ready.json`     | Sac shopping / prête    | a/5f53eafe-1167-11ee-bb7c-771903b5c57f/h4SpCote3h.json |
| `express.json`   | Scooter de livraison    | a/31988cb4-1171-11ee-a922-77518b5a1410/LlGIxPZ3to.json |
| `tour.json`      | Camion de livraison     | a/fd5c2302-1189-11ee-9744-dfd8dd53047f/8qujwf4S3I.json |

Pour remplacer une scène : déposer le nouveau `.json` (vectoriel pur, sans
`rasterAssets`, < 200 KB) sous le même nom — le lecteur (`components/ui/lottie.tsx`)
et le repli CSS ne changent pas.
