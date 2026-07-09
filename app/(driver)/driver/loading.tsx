/**
 * Squelette de repli du segment `driver` — l'accueil, et toute page qui n'aurait
 * pas encore le sien.
 *
 * Pourquoi ce fichier : sans lui, la frontière de chargement la plus proche est
 * le squelette de groupe `(driver)/loading.tsx`, qui ne rend pas la barre du bas
 * — elle disparaissait puis revenait à chaque changement d'onglet (ressenti
 * « relancement » de ~4 s, le temps du rendu serveur dynamique). Ce loader-ci,
 * placé au niveau du segment `driver`, prend le dessus pour les navigations
 * internes : la barre reste à l'écran, seul le contenu est remplacé par un
 * squelette → transition perçue instantanée (< 100 ms), les données arrivent
 * ensuite en streaming.
 *
 * Chaque sous-page définit malgré tout SON propre `loading.tsx` (règle non
 * négociable de `CLAUDE.md`) : cette forme-ci — titre, carte, tuiles — ne
 * ressemble ni à un écran de connexion, qui n'a pas de barre du bas, ni à une
 * sous-page à en-tête de retour.
 */
export { PageSkeleton as default } from "@/components/driver/driver-skeleton";
