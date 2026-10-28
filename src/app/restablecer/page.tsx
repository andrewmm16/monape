import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { NewPasswordForm } from "@/components/auth/auth-forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Definir contraseña" };

/** Destino de los enlaces de invitación y de recuperación de contraseña. */
export default async function NewPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/ingresar?motivo=enlace-invalido");
  return (
    <AuthCard title="Definir contraseña" description="Elija una contraseña segura para su cuenta.">
      <NewPasswordForm />
    </AuthCard>
  );
}
