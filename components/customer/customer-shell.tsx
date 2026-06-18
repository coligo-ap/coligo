/**
 * @deprecated Passe-plat. Le chrome client (header / bottom-nav / footer +
 * providers) est désormais rendu UNE FOIS dans `(customer)/layout.tsx`
 * (CustomerChrome), PERSISTANT entre navigations — au lieu d'être re-monté par
 * chaque page. Ce composant est conservé uniquement pour ne pas toucher les
 * pages qui l'enveloppent encore (`<CustomerShell>…</CustomerShell>`) : il rend
 * juste son contenu. `hideHeader` est ignoré (le header est géré par route dans
 * CustomerChrome). À retirer progressivement des pages.
 */
export function CustomerShell({
  children,
}: {
  children: React.ReactNode;
  hideHeader?: boolean;
}) {
  return <>{children}</>;
}
