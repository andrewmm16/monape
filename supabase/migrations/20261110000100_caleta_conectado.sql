-- =============================================================================
-- 0021 · Reclutador Caleta · estado «conectado»
--
-- Con una cuenta gratuita de LinkedIn no se puede escribir a quien no es
-- contacto (InMail es de pago). El flujo es: invitación sin nota («contactado»)
-- → la persona acepta («conectado») → se le envía el mensaje directo gratis.
-- Este estado separa «aceptó la invitación» de «respondió al mensaje».
-- =============================================================================

alter type public.caleta_status add value if not exists 'conectado' after 'contactado';
