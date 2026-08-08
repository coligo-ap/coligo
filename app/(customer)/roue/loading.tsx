/**
 * Squelette de la Roue Coligo — content-only (coque persistante).
 */
export default function WheelLoading() {
  return (
    <div className="mx-auto max-w-lg px-4 py-4 lg:px-6 lg:py-8">
      <div className="bg-surface-3 h-7 w-40 animate-pulse rounded-lg" />
      <div className="bg-surface-3 mx-auto mt-6 aspect-square w-72 animate-pulse rounded-full" />
      <div className="bg-surface-3 rounded-card-lg mt-6 h-14 w-full animate-pulse" />
    </div>
  );
}
