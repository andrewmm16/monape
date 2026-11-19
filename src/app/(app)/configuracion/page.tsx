import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Configuración" };

type ConfigLink = { href: string; title: string; description: string };

export default async function ConfigIndexPage() {
  const user = await requirePageUser();
  const options: ConfigLink[] = [];
  if (can(user.role, "email_templates:manage")) {
    options.push({
      href: "/configuracion/plantillas-correo",
      title: "Plantillas de correo",
      description: "Edite los correos que se envían a las personas candidatas al cambiar su estado.",
    });
  }
  if (can(user.role, "privacy:manage")) {
    options.push({
      href: "/configuracion/privacidad",
      title: "Aviso de privacidad",
      description: "Versiones del aviso que se muestra a los postulantes en la página pública.",
    });
  }
  if (can(user.role, "candidate_portal:manage")) {
    options.push({
      href: "/configuracion/portal-candidato",
      title: "Portal del candidato",
      description: "Enlace privado con el que cada persona consulta en qué etapa va su postulación.",
    });
  }
  if (can(user.role, "users:manage")) {
    options.push({
      href: "/configuracion/aprendizaje-motor",
      title: "Aprendizaje del motor",
      description: "Lo que el motor de reglas aprendió de la IA y cuánto depende todavía de ella. Puede deshacer cualquier regla.",
    });
  }
  if (can(user.role, "users:manage")) {
    options.push({
      href: "/configuracion/incidentes",
      title: "Incidentes de seguridad",
      description: "Registro de incidentes, plazos para avisar a la Autoridad y simulacros.",
    });
  }
  if (options.length === 0) notFound();

  return (
    <>
      <PageHeader title="Configuración" description="Ajustes del área de Recursos Humanos." />
      <div className="grid gap-4 sm:grid-cols-2">
        {options.map((option) => (
          <Link key={option.href} href={option.href} className="block">
            <Card className="h-full transition-colors hover:border-brand/50">
              <CardHeader>
                <CardTitle>{option.title}</CardTitle>
                <CardDescription>{option.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
