import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AccessDenied({ message = "No tiene permisos para ver esta sección." }: { message?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <ShieldAlertIcon className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">Acceso restringido</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="outline">
        <Link href="/panel">Volver al panel</Link>
      </Button>
    </div>
  );
}
