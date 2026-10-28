/**
 * Borrador de aviso de privacidad para candidatos. Copia fiel de la sección
 * «Borrador de aviso de privacidad para candidatos» de docs/privacidad-y-legal.md
 * (sin las marcas de negrita, porque el texto se muestra siempre como texto
 * plano). Conserva los marcadores [PENDIENTES]: el área legal debe completarlos
 * y aprobar el texto antes de activarlo.
 */
export const PRIVACY_NOTICE_TEMPLATE_TITLE = "Aviso de privacidad para candidatos";

export const PRIVACY_NOTICE_TEMPLATE_BODY = [
  "[RAZÓN SOCIAL], con RUC [RUC] y domicilio en [DOMICILIO], tratará los datos personales que usted nos proporcione en su postulación (datos de contacto, currículum y la información que este contenga) con la finalidad de gestionar el proceso de reclutamiento y selección para el puesto al que postula: evaluar su perfil frente a los requisitos del puesto, comunicarnos con usted y registrar el resultado del proceso.",
  "Para apoyar la revisión de su currículum utilizamos herramientas automatizadas que comparan su contenido con los requisitos del puesto [y, de aprobarse: un servicio de inteligencia artificial de [PROVEEDOR], ubicado en [PAÍS]]. Estas herramientas no toman decisiones: el personal de Recursos Humanos revisa cada candidatura y decide.",
  "Sus datos serán accesibles por el personal de Recursos Humanos y las personas que participen en la evaluación del puesto, y se almacenan en servicios de [Supabase (región [REGIÓN])] y [Vercel], que actúan como encargados del tratamiento. Los conservaremos durante [PLAZO] después de concluido el proceso [o, si usted lo autoriza, durante [PLAZO] para considerarlo en futuras vacantes], y luego serán eliminados o anonimizados.",
  "Usted puede ejercer sus derechos de acceso, rectificación, cancelación y oposición escribiendo a [CORREO DE CONTACTO], adjuntando una copia de su documento de identidad. Si considera que sus derechos no han sido atendidos, puede presentar un reclamo ante la Autoridad Nacional de Protección de Datos Personales. Banco de datos: [NOMBRE Y CÓDIGO DE INSCRIPCIÓN EN EL RNPDP].",
].join("\n\n");
