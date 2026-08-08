// =============================================================================
// IDV — PORTÉE DE THÈME du parcours. Le même flux tourne dans TROIS espaces
// qui n'ont pas les mêmes variables :
//   • livreur / chauffeur : tokens `--d-*` … mais ATTENTION, `--d-accent` y est
//     un FOND lavande très clair, pas la couleur de marque — s'en servir comme
//     couleur d'action donnait des boutons quasi blancs (bug vécu) ; la vraie
//     couleur d'action est `--d-violet` ;
//   • commerçant : AUCUN token `--d-*` → tout serait vide.
//
// D'où le jeu de variables `--idv-*`, résolues une fois pour toutes avec un
// repli sur les couleurs de marque. Il est déclaré dans app/design-tokens.css
// (couche 4) : ce composant ne fait plus qu'ouvrir la portée `.idv-scope`.
// =============================================================================

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
      {children}
    </div>
  );
}
