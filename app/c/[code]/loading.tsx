export default function Loading() {
  return (
    <main className="bg-surface-2 min-h-dvh">
      <div
        className="h-44 px-4"
        style={{
          backgroundImage:
            "linear-gradient(140deg, var(--auth-g1, var(--color-primary-600)) 0%, var(--auth-g2, var(--color-primary-700)) 55%, var(--auth-g3, var(--color-primary-800)) 100%)",
        }}
      />
      <div className="mx-auto -mt-10 max-w-md space-y-4 px-4">
        <div className="bg-surface h-44 animate-pulse rounded-lg" />
        <div className="bg-surface h-14 animate-pulse rounded-lg" />
        <div className="bg-surface h-36 animate-pulse rounded-lg" />
      </div>
    </main>
  );
}
