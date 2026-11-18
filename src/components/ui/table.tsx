"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * En el celular (< 640 px), cada fila pasa a ser una tarjeta: se ocultan los
 * encabezados y cada celda muestra el suyo desde su `data-label` (las celdas
 * sin `data-label`, como el nombre o las acciones, van sin título). Las celdas
 * con `hidden` siguen ocultas; la casilla de selección va arriba a la derecha.
 * En pantallas mayores es una tabla normal.
 */
const STACKED_ON_MOBILE = [
  "max-sm:block max-sm:[&_thead]:hidden max-sm:[&_tbody]:block",
  "max-sm:[&_tr]:relative max-sm:[&_tr]:flex max-sm:[&_tr]:flex-col max-sm:[&_tr]:gap-2 max-sm:[&_tr]:py-3",
  "max-sm:[&_td:not(.hidden)]:block max-sm:[&_td]:px-3 max-sm:[&_td]:py-0 max-sm:[&_td]:text-left max-sm:[&_td]:whitespace-normal",
  "max-sm:[&_td:empty]:hidden",
  "max-sm:[&_tr:has([type=checkbox],[role=checkbox])]:pr-10 max-sm:[&_td:has([type=checkbox],[role=checkbox])]:absolute max-sm:[&_td:has([type=checkbox],[role=checkbox])]:top-3 max-sm:[&_td:has([type=checkbox],[role=checkbox])]:right-0",
  "max-sm:[&_td[data-label]]:before:mb-0.5 max-sm:[&_td[data-label]]:before:block max-sm:[&_td[data-label]]:before:text-xs max-sm:[&_td[data-label]]:before:font-normal max-sm:[&_td[data-label]]:before:text-muted-foreground max-sm:[&_td[data-label]]:before:content-[attr(data-label)]",
].join(" ")

function Table({ className, stacked = false, ...props }: React.ComponentProps<"table"> & { stacked?: boolean }) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", stacked && STACKED_ON_MOBILE, className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted [&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
