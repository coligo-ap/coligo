// Le middleware redirige déjà vers /login ou /dashboard selon l'état auth.
export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-muted text-sm">Redirection…</div>
    </div>
  );
}
