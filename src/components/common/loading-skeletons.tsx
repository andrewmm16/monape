import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueletos reutilizables para los `loading.tsx` de cada ruta.
 * Dan feedback instantáneo al navegar (streaming de Next.js) mientras el
 * Server Component termina de cargar datos y renderizar.
 */

/** Encabezado de página (imita <PageHeader />). */
export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-7 w-52 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {withAction ? <Skeleton className="h-9 w-32 shrink-0" /> : null}
    </div>
  );
}

/** Rejilla de tarjetas de indicadores (StatTile). */
export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border bg-card p-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** Barra de filtros (buscador + select). */
export function FiltersSkeleton() {
  return (
    <div className="flex flex-wrap gap-2">
      <Skeleton className="h-9 w-full max-w-xs" />
      <Skeleton className="h-9 w-40" />
    </div>
  );
}

/** Tabla con cabecera y filas. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Tarjeta genérica con unas líneas. */
export function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-6">
      <Skeleton className="h-5 w-40" />
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
