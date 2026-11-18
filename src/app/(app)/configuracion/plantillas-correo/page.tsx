import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { ReplyToForm } from "@/components/email-templates/reply-to-form";
import { TemplateEditor } from "@/components/email-templates/template-editor";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  EMAIL_TEMPLATE_DEFAULTS,
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_META,
  EXAMPLE_TEMPLATE_VARS,
  talentInvitationFooter,
} from "@/modules/email-templates/defaults";
import { getEmailReplyTo, listEditedTemplates } from "@/modules/email-templates/queries";

export const metadata: Metadata = { title: "Plantillas de correo" };

/** Partes fijas de la invitación, para la vista previa del editor. */
const INVITATION_EXTRAS = {
  button: "Ver la vacante",
  buttonNote: "(solo si la vacante tiene página pública)",
  footer: talentInvitationFooter(EXAMPLE_TEMPLATE_VARS.empresa),
};

export default async function EmailTemplatesPage() {
  const user = await requirePageUser();
  if (!can(user.role, "email_templates:manage")) {
    return <AccessDenied message="Su rol no gestiona las plantillas de correo." />;
  }
  const supabase = await createSupabaseServerClient();
  const [edited, replyTo] = await Promise.all([listEditedTemplates(supabase), getEmailReplyTo(supabase)]);

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Plantillas de correo"
        description="Edita el texto de los correos que se envían a las personas candidatas: los avisos de cambio de estado y las invitaciones desde la base de talentos. Los avisos de estado siguen siendo opcionales (lo decide RRHH al cambiar el estado) y nunca incluyen el motivo ni las observaciones internas. Si no personalizas una plantilla, se usa el texto por defecto."
      />
      <div className="space-y-6">
        <ReplyToForm current={replyTo} />
        {EMAIL_TEMPLATE_KEYS.map((key) => (
          <TemplateEditor
            key={key}
            templateKey={key}
            label={EMAIL_TEMPLATE_META[key].label}
            when={EMAIL_TEMPLATE_META[key].when}
            defaults={EMAIL_TEMPLATE_DEFAULTS[key]}
            edited={edited[key]}
            extras={key === "invitacion_cartera" ? INVITATION_EXTRAS : undefined}
          />
        ))}
      </div>
    </>
  );
}
