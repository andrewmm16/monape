import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
      <p className="text-sm text-muted-foreground">El recurso no existe o no tiene permisos para verlo.</p>
      <Button asChild variant="outline">
        <Link href="/panel">Ir al panel</Link>
      </Button>
    </main>
  );
}
