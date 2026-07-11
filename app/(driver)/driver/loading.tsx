/**
 * Frontière de chargement de l'ACCUEIL livreur (`/driver`).
 *
 * L'accueil est une CARTE plein écran + barre « en ligne » dockée, PAS une page
 * titre/tuiles/liste. On rend donc `HomeSkeleton` (fond couleur-carte + skeleton
 * de la barre + barre du bas) et NON `PageSkeleton` : ce dernier affichait un
 * squelette de liste par-dessus la carte persistante (montée dans le layout),
 * d'où le saut visuel violent à l'arrivée du contenu — bug signalé par le user
 * en venant de « Gains ». La barre du bas reste à l'écran (transition < 100 ms),
 * la carte est déjà là (persistante), seul l'overlay maquette se streame.
 */
export { HomeSkeleton as default } from "@/components/driver/driver-skeleton";
