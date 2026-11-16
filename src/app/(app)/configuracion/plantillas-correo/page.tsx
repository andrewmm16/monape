import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { TemplateEditor } from "@/components/email-templates/template-editor";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  EMAIL_TEMPLATE_DEFAULTS,
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_META,
} from "@/modules/email-templates/defaults";
import { listEditedTemplates } from "@/modules/email-templates/queries";

export const metadata: Metadata = { title: "Plantillas de correo" };

export default async function EmailTemplatesPage() {
  const user = await requirePageUser();
  if (!can(user.role, "email_templates:manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const edited = await listEditedTemplates(supabase);

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Plantillas de correo"
        description="Edita el texto de los correos que se envían a las personas candidatas al cambiar su estado. El aviso sigue siendo opcional (lo decide RRHH al cambiar el estado) y nunca incluye el motivo ni las observaciones internas. Si no personalizas una plantilla, se usa el texto por defecto."
      />
      <div className="space-y-6">
        {EMAIL_TEMPLATE_KEYS.map((key) => (
          <TemplateEditor
            key={key}
            templateKey={key}
            label={EMAIL_TEMPLATE_META[key].label}
            when={EMAIL_TEMPLATE_META[key].when}
            defaults={EMAIL_TEMPLATE_DEFAULTS[key]}
            edited={edited[key]}
          />
        ))}
      </div>
    </>
  );
}
