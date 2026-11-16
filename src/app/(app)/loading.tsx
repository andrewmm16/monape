import { CardSkeleton, PageHeaderSkeleton } from "@/components/common/loading-skeletons";

/** Esqueleto genérico para cualquier ruta de la app sin loading propio. */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <PageHeaderSkeleton />
      <CardSkeleton lines={3} />
      <CardSkeleton lines={5} />
    </div>
  );
}
