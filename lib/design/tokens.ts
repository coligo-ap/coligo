/**
 * COLIGO — MIROIR TYPESCRIPT DES DESIGN TOKENS
 *
 * `app/design-tokens.css` est la source de vérité de l'identité visuelle. Ce
 * fichier en est le MIROIR pour les contextes où `var(--token)` CSS n'existe
 * pas et ne peut pas exister :
 *
 *   - MapLibre GL  : les `paint properties` sont peintes en WebGL, hors CSS ;
 *   - pdf-lib      : génération serveur, sans DOM ni feuille de style ;
 *   - canvas 2D    : `fillStyle` n'interprète pas les variables CSS ;
 *   - Capacitor    : APIs natives (barre de statut, splash) qui exigent un hex.
 *
 * RÈGLE : ne JAMAIS écrire un hex ailleurs que dans ces deux fichiers. Les
 * valeurs ci-dessous doivent rester identiques à leur équivalent CSS — le
 * script `scripts/check-design-tokens.mjs` le vérifie à chaque lint.
 *
 * Vitrine : /design-system · doc : docs/design-system.md
 */

/** Violet de marque Coligo — échelle primaire (`--color-primary-*`). */
export const PRIMARY = {
  50: "#f4eefe",
  100: "#e9ddfd",
  200: "#d2bcfb",
  300: "#b493f9",
  400: "#8a4dff",
  500: "#7a3aec",
  600: "#6c2bd9",
  700: "#4b1fa6",
  800: "#3a1880",
  900: "#2b1160",
} as const;

/** Rose de marque Coligo — PROMOTIONS uniquement (`--color-accent-*`). */
export const ACCENT = {
  50: "#fff0f6",
  100: "#ffdcea",
  200: "#ffb8d5",
  300: "#ff8abb",
  400: "#ff5499",
  500: "#ff2d7a",
  600: "#e6007a",
  700: "#c00068",
  800: "#990052",
  900: "#7a0042",
  950: "#4d0029",
} as const;

/** États sémantiques (`--color-success/warning/danger/info-*`). */
export const SUCCESS = {
  50: "#ecfdf5",
  100: "#d1fae5",
  500: "#10b981",
  600: "#059669",
  700: "#047857",
} as const;

export const WARNING = {
  50: "#fffbeb",
  100: "#fef3c7",
  500: "#f59e0b",
  600: "#d97706",
  700: "#b45309",
} as const;

export const DANGER = {
  50: "#fef2f2",
  100: "#fee2e2",
  500: "#ef4444",
  600: "#dc2626",
  700: "#b91c1c",
} as const;

export const INFO = {
  50: "#f0f9ff",
  100: "#e0f2fe",
  500: "#0ea5e9",
  600: "#0284c7",
  700: "#0369a1",
} as const;

/** Neutres du thème CLAIR (`--color-surface/foreground/border…`). */
export const NEUTRAL_LIGHT = {
  background: "#ffffff",
  surface: "#ffffff",
  surface2: "#f7f7fb",
  surface3: "#efeff5",
  foreground: "#1a1a2e",
  muted: "#6b6b80",
  subtle: "#9b9bb0",
  border: "#ececf2",
  borderStrong: "#dcdce6",
} as const;

/** Neutres du thème SOMBRE (mêmes rôles, valeurs du remap `.theme-dark`). */
export const NEUTRAL_DARK = {
  background: "#0b0c12",
  surface: "#161823",
  surface2: "#0e0f16",
  surface3: "#1f2230",
  foreground: "#f4f5fa",
  muted: "#9ca0b3",
  subtle: "#80849a",
  border: "#262838",
  borderStrong: "#343852",
} as const;

/**
 * Palette des espaces partenaires (livreur / chauffeur / Drive) — miroir des
 * tokens `--violet` / `--go` / `--red` / `--amber` et des neutres `--d-*`.
 */
export const PARTNER = {
  violet: PRIMARY[600],
  violetLight: PRIMARY[400],
  violetDark: PRIMARY[700],
  violetSoft: "#f3edfc",
  go: "#16b364",
  goLight: "#28d27c",
  goDark: "#0e8c4d",
  red: "#e5484d",
  amber: WARNING[500],
  amberDark: "#c2790a",
} as const;

/** Neutres Drive (`--d-*`) — clair puis sombre. */
export const DRIVE_LIGHT = {
  page: "#e9ebf1",
  surface: "#ffffff",
  ink: "#0b0c12",
  muted: "#6b7280",
  line: "#eef0f4",
  soft: "#f4f5f9",
  accent: "#eeeefd",
  field: "#f6f3fe",
  violet: PRIMARY[600],
} as const;

export const DRIVE_DARK = {
  page: "#06070b",
  surface: "#161823",
  ink: "#ffffff",
  muted: "#9ca0b3",
  line: "#262838",
  soft: "#1f2230",
  violet: PRIMARY[300],
} as const;

/** Encre binaire — impression thermique, QR, contrastes absolus. */
export const INK = { black: "#000000", white: "#ffffff" } as const;

/**
 * Palette CARTE (MapLibre) — tracés, marqueurs et halos dessinés en WebGL.
 * Ces valeurs ne peuvent pas être des `var()` : la carte les lit au montage.
 */
export const MAP = {
  /** Tracé d'itinéraire principal (violet de marque). */
  route: PRIMARY[600],
  /** Contour clair sous le tracé, pour le détacher du fond de carte. */
  routeCasing: "#ffffff",
  /** Segment déjà parcouru / trajet secondaire. */
  routeMuted: "#b493f9",
  /** Point de départ (pastille verte). */
  origin: PARTNER.go,
  /** Point d'arrivée (pastille rose de marque). */
  destination: ACCENT[500],
  /** Position de l'utilisateur / du véhicule. */
  me: PRIMARY[600],
  /** Halo pulsé autour de la position. */
  meHalo: "rgba(108, 43, 217, 0.25)",
  /** Zone de service : remplissage + bordure. */
  zoneFill: "rgba(108, 43, 217, 0.14)",
  zoneLine: PRIMARY[600],
  /** Zone en conflit / exclue. */
  zoneDangerFill: "rgba(229, 72, 77, 0.14)",
  zoneDangerLine: PARTNER.red,
  /**
   * Vert « tracé » de la carte : polygone de zone dans l'éditeur admin et
   * épingle domicile du client. Distinct de `PARTNER.go` (#16b364) — les deux
   * verts coexistent depuis l'origine, les fusionner changerait le rendu.
   */
  green: "#16a34a",
  /** Pastille sombre posée sur la carte (véhicule, épingle destination). */
  vehicle: DRIVE_LIGHT.ink,
  /** Approche à pied / segment hors itinéraire (pointillés gris). */
  approach: "#b7bbc8",
} as const;

/**
 * Palette DOCUMENTS (pdf-lib) — relevés, versements, factures. pdf-lib attend
 * des composantes 0→1 : passer par `pdfRgb()` ci-dessous, jamais un hex brut.
 */
export const DOC = {
  ink: "#1a1a2e",
  muted: "#6b6b80",
  line: "#dcdce6",
  zebra: "#f7f7fb",
  brand: PRIMARY[600],
  positive: SUCCESS[600],
  negative: DANGER[600],
} as const;

/**
 * Paliers de MÉRITE chauffeur (recrue → diamant). Palette de CONTENU : des
 * métaux (bronze, argent, or) et un éclat diamant qui n'ont volontairement
 * aucun équivalent dans l'échelle de marque. Consommée par
 * `lib/drive/driver-badge.ts`, qui en compose les dégradés.
 */
export const BADGE_TIERS = {
  recrue: { from: "#94A3B8", to: "#64748B", solid: "#64748B", text: INK.white },
  bronze: { from: "#D8A36B", to: "#A66A2E", solid: "#B4732E", text: INK.white },
  argent: { from: "#E2E8F0", to: "#94A3B8", solid: "#8A93A3", text: "#1F2937" },
  or: { from: "#F7D661", to: "#E0A815", solid: "#E0A815", text: "#3A2C00" },
  diamant: {
    from: "#67E8F9",
    to: "#7C3AED",
    solid: "#7C3AED",
    text: INK.white,
  },
} as const;

/**
 * Dégradés des BANNIÈRES PROMO (maquette « coligo-collection-finale »).
 * Palette de CONTENU choisie par le super-admin, pas l'identité de marque :
 * `deliv` (#7C3AED) et `brand` (#6D2FD8) sont deux violets PROCHES du violet
 * Coligo (#6c2bd9) mais DIFFÉRENTS — les aligner changerait le rendu des
 * bannières déjà publiées. Consommée par `lib/data/promo-banner-models.ts`.
 */
export const PROMO_GRADIENTS = {
  deliv: "linear-gradient(120deg,#7C3AED,#9B5CF0 35%,#BE93F2 65%,#DCC5F8)",
  brand: "linear-gradient(120deg,#6D2FD8,#8B4BE8 35%,#C86BD9 65%,#F0619A)",
  mint: "linear-gradient(120deg,#3F8D6C,#6AB08D 40%,#9FD3B6 75%,#5FA383)",
  sky: "linear-gradient(120deg,#8B93E8,#A6B4EE 30%,#BCD0F2 55%,#8E9AE4)",
  dusk: "linear-gradient(120deg,#1E3A5C,#33567F 30%,#6D7FA6 55%,#C9A24E 88%,#E4BE6A)",
  slate: "linear-gradient(120deg,#16161e,#2a2340 60%,#3a2c5e)",
} as const;

/**
 * Habillages du HÉROS DE RECRUTEMENT (/recrute), choisis par l'équipe depuis
 * l'administration. Ce sont des dégradés de CAMPAGNE, pas des tokens de
 * chrome : ils vivent ici parce qu'aucune couleur ne doit s'écrire hors des
 * fichiers de tokens, et parce qu'ils sont appliqués en variables CSS
 * calculées à l'exécution (le nom du preset vient de la base).
 */
export const RECRUTE_HERO_GRADIENTS = {
  /** Violet de marque — le défaut. */
  coligo: {
    g1: "#5b2eff",
    g2: PRIMARY[600],
    g3: PRIMARY[700],
    glow: ACCENT[500],
  },
  /** Violet profond, plus sobre et contrasté. */
  nuit: { g1: "#3b1178", g2: "#2a0f5e", g3: "#14062e", glow: PRIMARY[400] },
  /** Violet vers rose — campagnes et temps forts. */
  aurore: {
    g1: PRIMARY[600],
    g2: "#9b2fa8",
    g3: ACCENT[600],
    glow: ACCENT[300],
  },
  /** Vert — met en avant les gains. */
  emeraude: {
    g1: PARTNER.goDark,
    g2: PARTNER.go,
    g3: "#065f46",
    glow: PARTNER.goLight,
  },
  /** Chaud — saison, Ramadan, fêtes. */
  ambre: { g1: WARNING[700], g2: WARNING[600], g3: "#7c2d12", glow: "#f7bf4f" },
} as const;

/**
 * Palette DOCUMENTS — cartes de FIDÉLITÉ physiques (PDF d'impression 85,6 ×
 * 54 mm + aperçus de la console admin, lib/loyalty/card-templates.ts).
 * Valeurs FIGÉES : des cartes déjà imprimées circulent — ne pas retoucher un
 * modèle existant, en AJOUTER un.
 */
export const LOYALTY_CARD = {
  /** Modules du QR : VIOLET de marque sur panneau blanc (maquette 11482). */
  qrInk: PRIMARY[600],
  /** Panneau du QR (papier). */
  paper: INK.white,
  /** Pilules translucides posées sur la carte (« CARTE FIDÉLITÉ »…). */
  pillOnDark: "rgba(255,255,255,.16)",
  pillOnLight: "rgba(108,43,217,.08)",
  /** Badges stores du verso (App Store / Google Play) — noir profond. */
  badgeInk: "#0a0a0f",
  // Chaque modèle = STOPS du dégradé diagonal (135°, g1 → g2 → g3) — les MÊMES
  // teintes que les PNG public/brand/loyalty-card-bg-<clé>.png (générés une
  // fois, embarqués dans le PDF et affichés en aperçu console).
  violet: {
    g1: PRIMARY[900],
    g2: PRIMARY[600],
    g3: ACCENT[500],
    text: INK.white,
    subtext: "#e9dffb",
  },
  nuit: {
    g1: "#0e0620",
    g2: PRIMARY[800],
    g3: ACCENT[600],
    text: INK.white,
    subtext: "#cdbdeb",
  },
  clair: {
    g1: INK.white,
    g2: PRIMARY[50],
    g3: PRIMARY[100],
    text: "#1a1030",
    subtext: "#6b7080",
  },
  rose: {
    g1: ACCENT[800],
    g2: ACCENT[500],
    g3: ACCENT[400],
    text: INK.white,
    subtext: "#ffe0ec",
  },
} as const;

/** Durées et courbes de mouvement (miroir de `--duration-*` / `--ease-*`). */
export const MOTION = {
  fast: 160,
  base: 220,
  slow: 400,
  spring: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

/** `#rrggbb` → `{ r, g, b }` normalisé 0→1 (format attendu par pdf-lib). */
export function pdfRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

/** `#rrggbb` + opacité → `rgba(r, g, b, a)`, pour canvas et halos calculés. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = pdfRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
    b * 255
  )}, ${alpha})`;
}
