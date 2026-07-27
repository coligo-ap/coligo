import { THEME_GRAIN, type AppThemeModel } from "@/lib/config/app-themes";

// =============================================================================
// Décor des héros thémés (auth + accueil marketplace) — le MODÈLE de design
// (mig 0416) : blobs / vagues / halo / motifs. Deux usages :
//
//   • `model` fourni (accueil, aperçus admin) : rend UNIQUEMENT ce variant,
//     couleurs passées en props.
//   • `model` omis (héros d'auth, composant non-async) : rend les 4 variants,
//     la CSS n'affiche que celui de l'attribut `data-theme-model` posé sur
//     <html> par le layout racine — zéro hook, zéro hydratation risquée.
//
// Couleurs par défaut = variables du thème (--auth-blob-a/b) avec repli
// marque. Grain commun par-dessus. Animations 100 % CSS, coupées par
// prefers-reduced-motion. Toujours `aria-hidden` : purement décoratif.
// =============================================================================

const DECOR_CSS = `
@keyframes thdFloatA{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(10px,14px,0) scale(1.08)}}
@keyframes thdFloatB{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(-12px,-10px,0) scale(1.06)}}
@keyframes thdDrift{from{transform:translateX(0)}to{transform:translateX(-25%)}}
@keyframes thdPulse{from{opacity:.45;transform:scale(1)}to{opacity:.75;transform:scale(1.12)}}
@keyframes thdDots{from{background-position:0 0}to{background-position:36px 18px}}
.thd-float-a{animation:thdFloatA 11s ease-in-out infinite alternate}
.thd-float-b{animation:thdFloatB 13s ease-in-out infinite alternate}
.thd-float-c{animation:thdFloatA 9s ease-in-out infinite alternate-reverse}
.thd-drift{animation:thdDrift 26s linear infinite}
.thd-drift-2{animation:thdDrift 38s linear infinite reverse}
.thd-pulse{animation:thdPulse 7s ease-in-out infinite alternate}
.thd-pulse-2{animation:thdPulse 9s ease-in-out infinite alternate-reverse}
.thd-dots{animation:thdDots 24s linear infinite}
.thd-m{display:none}
html[data-theme-model="blobs"] .thd-m-blobs,html:not([data-theme-model]) .thd-m-blobs{display:block}
html[data-theme-model="vagues"] .thd-m-vagues{display:block}
html[data-theme-model="halo"] .thd-m-halo{display:block}
html[data-theme-model="motifs"] .thd-m-motifs{display:block}
@media (prefers-reduced-motion:reduce){.thd-float-a,.thd-float-b,.thd-float-c,.thd-drift,.thd-drift-2,.thd-pulse,.thd-pulse-2,.thd-dots{animation:none}}
`;

/** Une vague SVG pleine largeur (utilisée en double couche décalée). */
function Wave({ fill, className }: { fill: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d="M0,64 C150,110 300,20 450,52 C600,84 750,110 900,72 C1050,34 1150,60 1200,52 L1200,120 L0,120 Z"
        fill={fill}
      />
    </svg>
  );
}

function Variant({
  variant,
  a,
  b,
  forced,
}: {
  variant: AppThemeModel;
  a: string;
  b: string;
  /** true = variant rendu seul (pas de switch CSS par attribut). */
  forced: boolean;
}) {
  const wrap = forced ? "" : `thd-m thd-m-${variant}`;
  if (variant === "blobs") {
    return (
      <div aria-hidden className={wrap}>
        <div
          className="thd-float-a absolute -top-12 -left-10 size-44 rounded-full opacity-70"
          style={{ background: a }}
        />
        <div
          className="thd-float-b absolute -right-12 -bottom-20 size-52 rounded-full opacity-[0.55]"
          style={{ background: b }}
        />
        <div className="thd-float-c absolute top-5 right-1/4 size-14 rounded-full bg-white/15" />
      </div>
    );
  }
  if (variant === "vagues") {
    return (
      <div aria-hidden className={wrap}>
        {/* Deux couches de vagues à 200 % de large qui dérivent en boucle. */}
        <div className="absolute inset-x-0 bottom-0 h-16 overflow-hidden">
          <div className="thd-drift absolute bottom-0 h-full w-[200%] opacity-40">
            <Wave fill={a} className="h-full w-1/2" />
            <Wave fill={a} className="absolute top-0 left-1/2 h-full w-1/2" />
          </div>
          <div className="thd-drift-2 absolute -bottom-1 h-full w-[200%] opacity-55">
            <Wave fill={b} className="h-full w-1/2" />
            <Wave fill={b} className="absolute top-0 left-1/2 h-full w-1/2" />
          </div>
        </div>
        <div className="absolute top-4 right-6 size-10 rounded-full bg-white/15" />
      </div>
    );
  }
  if (variant === "halo") {
    return (
      <div aria-hidden className={wrap}>
        <div
          className="thd-pulse absolute -top-16 -left-16 size-64 rounded-full blur-2xl"
          style={{
            backgroundImage: `radial-gradient(closest-side, ${a}, transparent)`,
          }}
        />
        <div
          className="thd-pulse-2 absolute -right-20 -bottom-24 size-72 rounded-full blur-2xl"
          style={{
            backgroundImage: `radial-gradient(closest-side, ${b}, transparent)`,
          }}
        />
      </div>
    );
  }
  // motifs — trame de points + touche de couleur.
  return (
    <div aria-hidden className={wrap}>
      <div
        className="thd-dots absolute inset-0 opacity-35"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,.35) 1.2px, transparent 1.4px)",
          backgroundSize: "18px 18px",
        }}
      />
      <div
        className="absolute -top-10 -right-8 size-32 rounded-full opacity-50"
        style={{ background: a }}
      />
      <div
        className="absolute -bottom-12 -left-6 size-24 rounded-full opacity-40"
        style={{ background: b }}
      />
    </div>
  );
}

export function ThemeDecor({
  model,
  a = "var(--auth-blob-a,#8A4DFF)",
  b = "var(--auth-blob-b,#FF2D7A)",
  grain = true,
}: {
  /** Fourni = ce variant seul ; omis = les 4 + switch data-theme-model. */
  model?: AppThemeModel;
  a?: string;
  b?: string;
  grain?: boolean;
}) {
  const variants: AppThemeModel[] = model
    ? [model]
    : ["blobs", "vagues", "halo", "motifs"];
  return (
    <>
      <style>{DECOR_CSS}</style>
      {variants.map((v) => (
        <Variant key={v} variant={v} a={a} b={b} forced={!!model} />
      ))}
      {grain && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.16] mix-blend-overlay"
          style={{ backgroundImage: `url("${THEME_GRAIN}")` }}
        />
      )}
    </>
  );
}
