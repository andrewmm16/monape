import { FiltersSkeleton, PageHeaderSkeleton, TableSkeleton } from "@/components/common/loading-skeletons";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">Cargando vacantes…</span>
      <PageHeaderSkeleton withAction />
      <FiltersSkeleton />
      <TableSkeleton rows={8} cols={5} />
    </div>
  );
}
