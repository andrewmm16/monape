import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    // El título conserva al menos 16rem: si las acciones no caben a su lado (tableta), bajan a la línea siguiente.
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1 sm:flex-1 sm:basis-64">
        {eyebrow ? <div className="text-sm text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex max-w-full flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
