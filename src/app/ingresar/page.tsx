import type { Metadata } from "next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Ingresar" };

const REASONS: Record<string, string> = {
  "cuenta-desactivada": "Su cuenta está desactivada. Contacte al administrador.",
  "enlace-invalido": "El enlace no es válido o expiró. Solicite uno nuevo.",
  inactividad: "Su sesión se cerró por inactividad. Ingrese nuevamente.",
};

export default async function SignInPage({ searchParams }: PageProps<"/ingresar">) {
  const params = await searchParams;
  const reason = typeof params.motivo === "string" ? REASONS[params.motivo] : undefined;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <AuthCard title="Ingresar" description="Acceso exclusivo para el personal autorizado.">
      {reason ? (
        <Alert className="mb-4">
          <AlertDescription>{reason}</AlertDescription>
        </Alert>
      ) : null}
      <SignInForm next={next} />
    </AuthCard>
  );
}
