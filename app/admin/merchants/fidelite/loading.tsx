export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="bg-surface-2 h-10 w-56 animate-pulse rounded-md" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-surface-2 h-32 animate-pulse rounded-lg" />
      ))}
    </div>
  );
}
