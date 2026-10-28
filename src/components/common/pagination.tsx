import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  pageSize,
  total,
  hrefForPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefForPage: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Paginación">
      <span className="text-muted-foreground">
        {from}–{to} de {total}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefForPage(page - 1)}>
              <ChevronLeftIcon /> Anterior
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeftIcon /> Anterior
          </Button>
        )}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefForPage(page + 1)}>
              Siguiente <ChevronRightIcon />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Siguiente <ChevronRightIcon />
          </Button>
        )}
      </div>
    </nav>
  );
}
