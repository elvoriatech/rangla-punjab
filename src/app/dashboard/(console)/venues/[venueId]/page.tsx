export default async function VenuePage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Venue {venueId}</h1>
      <p className="mt-2 text-sm text-neutral-500">Placeholder — menu editor built in Phase 1.</p>
    </main>
  );
}
