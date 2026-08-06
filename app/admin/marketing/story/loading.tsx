// Squelette de l'onglet Story (règle : loading.tsx sur toute route qui await).
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse space-y-4 p-4 lg:p-6">
      <div className="bg-surface-3 h-4 w-2/3 rounded" />
      <div className="bg-surface-3 h-24 rounded-[16px]" />
      <div className="bg-surface-3 h-56 rounded-[16px]" />
      <div className="bg-surface-3 h-24 rounded-[16px]" />
    </div>
  );
}
