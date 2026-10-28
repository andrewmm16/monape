import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PublicJobNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-xl font-semibold">Vacante no encontrada</h1>
      <p className="text-sm text-muted-foreground">La convocatoria no existe o ya no está disponible.</p>
      <Button asChild variant="outline">
        <Link href="/empleos">Ver vacantes abiertas</Link>
      </Button>
    </div>
  );
}
