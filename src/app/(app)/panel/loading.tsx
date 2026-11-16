import { CardSkeleton, PageHeaderSkeleton, StatTilesSkeleton } from "@/components/common/loading-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Cargando el panel…</span>
      <PageHeaderSkeleton />
      <StatTilesSkeleton count={4} />
      <div className="grid gap-6 lg:grid-cols-2">
        <CardSkeleton lines={6} />
        <CardSkeleton lines={6} />
      </div>
    </div>
  );
}
