"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EMAIL_TEMPLATE_KEYS } from "./defaults";
import { saveTemplateSchema, type SaveTemplateInput } from "./schemas";

const CONFIG_PATH = "/configuracion/plantillas-correo";

/** Guarda (crea o actualiza) la versión editada de una plantilla de correo. */
export async function saveEmailTemplate(input: SaveTemplateInput): Promise<ActionResult> {
  return runAction(
    "email_templates.save",
    async () => {
      await requirePermission("email_templates:manage");
      const values = parseInput(saveTemplateSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data: existing, error: lookupError } = await supabase
        .from("email_templates")
        .select("key")
        .eq("key", values.key)
        .maybeSingle();
      if (lookupError) throw toAppError(lookupError);
      const { error } = existing
        ? await supabase.from("email_templates").update({ subject: values.subject, body: values.body }).eq("key", values.key)
        : await supabase.from("email_templates").insert({ key: values.key, subject: values.subject, body: values.body });
      if (error) throw toAppError(error);
      revalidatePath(CONFIG_PATH);
      return null;
    },
    "Plantilla guardada. Se usará en los próximos envíos.",
  );
}

/** Restaura una plantilla al texto por defecto del código (borra la versión editada). */
export async function resetEmailTemplate(key: string): Promise<ActionResult> {
  return runAction(
    "email_templates.reset",
    async () => {
      await requirePermission("email_templates:manage");
      const validKey = parseInput(z.enum(EMAIL_TEMPLATE_KEYS), key);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("email_templates").delete().eq("key", validKey);
      if (error) throw toAppError(error);
      revalidatePath(CONFIG_PATH);
      return null;
    },
    "Plantilla restaurada al texto original.",
  );
}
