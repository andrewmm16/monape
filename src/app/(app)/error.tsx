"use client";

import { Button } from "@/components/ui/button";

/** Error inesperado en una página privada: nunca muestra detalles técnicos. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-xl font-semibold">No se pudo cargar esta sección</h1>
      <p className="text-sm text-muted-foreground">
        Ocurrió un error inesperado. Si persiste, informe al administrador indicando la hora del incidente.
      </p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
