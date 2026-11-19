"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DRILL_CASE,
  closeFormSchema,
  eventFormSchema,
  incidentFormSchema,
  limaLocalToIso,
  officerFormSchema,
  reviewFormSchema,
  type CloseFormInput,
  type EventFormInput,
  type IncidentFormInput,
  type OfficerFormInput,
  type ReviewFormInput,
} from "./schemas";

const idSchema = z.uuid();

function revalidate(id?: string) {
  revalidatePath("/configuracion/incidentes");
  if (id) revalidatePath(`/configuracion/incidentes/${id}`);
  revalidatePath("/panel");
}

/** Registra un incidente (solo administración). */
export async function createIncident(input: IncidentFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "incidents.create",
    async () => {
      await requirePermission("users:manage");
      const values = parseInput(incidentFormSchema, input);
      const detectedAt = limaLocalToIso(values.detectedAt);
      if (!detectedAt) {
        throw new AppError("Revise los datos ingresados.", "validation", {
          detectedAt: ["La fecha y la hora no son válidas o están en el futuro"],
        });
      }
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("security_incidents")
        .insert({
          title: values.title,
          detected_at: detectedAt,
          detected_by_text: values.detectedBy,
          severity: values.severity,
          description: values.description,
          affected_data: values.affectedData,
          affected_people: values.affectedPeople,
          sensitive_data: values.sensitiveData,
        })
        .select("id")
        .single();
      if (error) throw toAppError(error);
      revalidate();
      return { id: data.id };
    },
    "Incidente registrado. El plazo de 48 h corre desde la fecha de detección.",
  );
}

/** Crea el simulacro que sugiere la política: la clave del worker de IA apareció en un chat. */
export async function startDrill(): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "incidents.drill",
    async () => {
      await requirePermission("users:manage");
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("security_incidents")
        .insert({
          title: DRILL_CASE.title,
          description: DRILL_CASE.description,
          affected_data: DRILL_CASE.affectedData,
          affected_people: 0,
          detected_by_text: DRILL_CASE.detectedBy,
          severity: "alta",
          sensitive_data: false,
          is_drill: true,
        })
        .select("id")
        .single();
      if (error) throw toAppError(error);
      revalidate();
      return { id: data.id };
    },
    "Simulacro iniciado. Recorra los pasos como si fuera real.",
  );
}

/** Agrega una acción, una notificación o una nota a la bitácora (no se puede editar ni borrar después). */
export async function addIncidentEvent(incidentId: string, input: EventFormInput): Promise<ActionResult> {
  return runAction(
    "incidents.event",
    async () => {
      await requirePermission("users:manage");
      const id = parseInput(idSchema, incidentId);
      const values = parseInput(eventFormSchema, input);
      const occurredAt = limaLocalToIso(values.occurredAt);
      if (!occurredAt) {
        throw new AppError("Revise los datos ingresados.", "validation", {
          occurredAt: ["La fecha y la hora no son válidas o están en el futuro"],
        });
      }
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("security_incident_events").insert({
        incident_id: id,
        kind: values.kind,
        description: values.description,
        recipient: values.kind === "notificacion" ? values.recipient : null,
        occurred_at: occurredAt,
      });
      if (error) throw toAppError(error, { notFound: "El incidente no existe." });
      revalidate(id);
      return null;
    },
    "Anotado en la bitácora.",
  );
}

/** Marca el incidente como contenido. */
export async function markIncidentContained(incidentId: string): Promise<ActionResult> {
  return runAction(
    "incidents.contain",
    async () => {
      await requirePermission("users:manage");
      const id = parseInput(idSchema, incidentId);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("security_incidents")
        .update({ status: "contenido" })
        .eq("id", id)
        .eq("status", "abierto")
        .select("id");
      if (error) throw toAppError(error);
      if (!data?.length) throw new AppError("Solo un incidente abierto puede pasar a contenido.", "conflict");
      revalidate(id);
      return null;
    },
    "Incidente marcado como contenido.",
  );
}

/** Cierra el incidente con su causa y lo que se cambió para que no se repita. */
export async function closeIncident(incidentId: string, input: CloseFormInput): Promise<ActionResult> {
  return runAction(
    "incidents.close",
    async () => {
      await requirePermission("users:manage");
      const id = parseInput(idSchema, incidentId);
      const values = parseInput(closeFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("security_incidents")
        .update({ status: "cerrado", cause: values.cause, prevention: values.prevention })
        .eq("id", id)
        .neq("status", "cerrado")
        .select("id");
      if (error) throw toAppError(error);
      if (!data?.length) throw new AppError("El incidente ya está cerrado o no existe.", "conflict");
      revalidate(id);
      return null;
    },
    "Incidente cerrado. Haga la revisión dentro de los 5 días hábiles.",
  );
}

/** Registra la revisión posterior (una sola vez, con el incidente cerrado). */
export async function registerIncidentReview(incidentId: string, input: ReviewFormInput): Promise<ActionResult> {
  return runAction(
    "incidents.review",
    async () => {
      await requirePermission("users:manage");
      const id = parseInput(idSchema, incidentId);
      const values = parseInput(reviewFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("security_incidents")
        .update({ review_done_at: new Date().toISOString(), review_notes: values.notes })
        .eq("id", id)
        .eq("status", "cerrado")
        .is("review_done_at", null)
        .select("id");
      if (error) throw toAppError(error);
      if (!data?.length) throw new AppError("La revisión solo se registra una vez y con el incidente cerrado.", "conflict");
      revalidate(id);
      return null;
    },
    "Revisión registrada.",
  );
}

/** Designa (o cambia) al oficial de datos personales. */
export async function saveSecurityOfficer(input: OfficerFormInput): Promise<ActionResult> {
  return runAction(
    "incidents.officer",
    async () => {
      await requirePermission("users:manage");
      const values = parseInput(officerFormSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("security_settings")
        .update({ officer_name: values.name, officer_email: values.email })
        .eq("id", true)
        .select("id");
      if (error) throw toAppError(error);
      if (!data?.length) throw new AppError("No se pudo guardar al oficial de datos personales.", "forbidden");
      revalidate();
      return null;
    },
    "Oficial de datos personales designado.",
  );
}
