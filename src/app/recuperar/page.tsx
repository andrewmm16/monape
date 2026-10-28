import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordResetRequestForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Recuperar acceso" };

export default function PasswordResetRequestPage() {
  return (
    <AuthCard
      title="Recuperar acceso"
      description="Le enviaremos un enlace temporal para definir una nueva contraseña."
    >
      <PasswordResetRequestForm />
    </AuthCard>
  );
}
