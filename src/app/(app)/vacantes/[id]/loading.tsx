import { CardSkeleton, PageHeaderSkeleton, StatTilesSkeleton } from "@/components/common/loading-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Cargando la vacante…</span>
      <PageHeaderSkeleton withAction />
      <StatTilesSkeleton count={3} />
      <CardSkeleton lines={5} />
      <CardSkeleton lines={4} />
    </div>
  );
}
