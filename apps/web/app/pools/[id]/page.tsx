export default function PoolDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="text-zinc-500">Pool detail for <code>{params.id}</code> — coming soon.</p>
    </div>
  );
}
