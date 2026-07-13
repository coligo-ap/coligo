// =============================================================================
// IDV — PORTÉE DE THÈME du parcours. Le même flux tourne dans TROIS espaces
// qui n'ont pas les mêmes variables :
//   • livreur / chauffeur : tokens `--d-*` … mais ATTENTION, `--d-accent` y est
//     un FOND lavande très clair (#f3edfc), pas la couleur de marque — s'en
//     servir comme couleur d'action donnait des boutons quasi blancs (bug
//     vécu, vu à la capture d'écran) ; la vraie couleur d'action est
//     `--d-violet` ;
//   • commerçant : AUCUN token `--d-*` → tout serait vide.
//
// D'où ce jeu de variables `--idv-*`, résolues une fois pour toutes, avec un
// repli sur les couleurs de marque Coligo. Toutes les surfaces IDV s'y
// réfèrent — plus jamais un `var(--d-accent)` utilisé comme couleur forte.
// =============================================================================

const CSS = `
.idv-scope {
  --idv-accent: var(--d-violet, #6C2BD9);
  --idv-accent-ink: #ffffff;
  --idv-soft: var(--d-soft, rgba(108, 43, 217, 0.08));
  --idv-tint: var(--d-accent, rgba(108, 43, 217, 0.10));
  --idv-card: var(--d-card, #ffffff);
  --idv-line: var(--d-line, rgba(0, 0, 0, 0.10));
  --idv-ink: var(--d-ink, #0b0c12);
  --idv-muted: var(--d-muted, #6b7280);
  --idv-ok: var(--d-mint, #10b981);
  --idv-warn: var(--d-amber, #f59e0b);
  --idv-bad: var(--d-coral, #ef4444);
  color: var(--idv-ink);
}
`;

export function IdvScope({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`idv-scope ${className}`} style={style}>
      <style>{CSS}</style>
      {children}
    </div>
  );
}
