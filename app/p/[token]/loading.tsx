/**
 * Squelette de la room panier partagé (page publique, ouverture WhatsApp).
 */
export default function SharedCartLoading() {
  return (
    <div className="bg-surface-2 min-h-dvh">
      <div className="from-primary-500 to-primary-800 h-36 bg-gradient-to-br" />
      <div className="mx-auto -mt-6 max-w-lg space-y-3 px-4">
        <div className="bg-surface-3 rounded-card h-10 animate-pulse" />
        <div className="bg-surface-3 rounded-sheet-lg h-48 animate-pulse" />
        <div className="bg-surface-3 rounded-sheet-lg h-32 animate-pulse" />
      </div>
    </div>
  );
}
