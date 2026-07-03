// Le build « light » de lottie-web (rendu SVG seul, ~45 KB gzip) n'expose pas
// ses propres types — on réutilise ceux de l'entrée principale.
declare module "lottie-web/build/player/lottie_light" {
  import lottie from "lottie-web";
  export default lottie;
}
