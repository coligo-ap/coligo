export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="bg-surface-2 h-10 w-56 animate-pulse rounded-[12px]" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface-2 h-24 animate-pulse rounded-[16px]"
        />
      ))}
    </div>
  );
}
