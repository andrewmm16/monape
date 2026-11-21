import type { Metadata } from "next";
import { BrandLogo } from "@/components/common/brand-logo";
import { BookingPicker } from "@/components/interviews/booking-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerEnv } from "@/lib/env";
import { getPublicBooking } from "@/modules/interviews/booking-public";
import { formatDuration, formatInterviewDateTime, safeHttpUrl } from "@/modules/interviews/datetime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Elige el horario de tu entrevista", robots: { index: false, follow: false } };

const MODALITY: Record<string, string> = { presencial: "Presencial", virtual: "Virtual", telefonica: "Telefónica" };

/**
 * Autoagenda (página pública, enlace privado, sin sesión): la persona elige
 * uno de los horarios que ofreció RRHH. Solo muestra el puesto, la modalidad,
 * la duración, el lugar y los horarios disponibles.
 */
export default async function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await getPublicBooking(token);
  const company = getServerEnv().PUBLIC_COMPANY_NAME ?? "Recursos Humanos";

  let body: React.ReactNode;
  if (!booking) {
    body = <p className="text-sm">Este enlace no es válido. Revisa que esté completo o escribe a Recursos Humanos.</p>;
  } else if (booking.status === "agendada") {
    body = (
      <p className="text-sm" data-testid="booking-confirmed">
        Tu entrevista ya está agendada{booking.scheduledAt ? ` para el ${formatInterviewDateTime(booking.scheduledAt)} (hora de Lima)` : ""}. Si necesitas
        cambiarla, escribe a Recursos Humanos.
      </p>
    );
  } else if (booking.status === "vencida" || booking.status === "cancelada") {
    body = (
      <p className="text-sm">
        Esta invitación ya no está disponible. Si todavía te interesa la entrevista, escribe a Recursos Humanos.
      </p>
    );
  } else if (booking.slots.length === 0) {
    body = <p className="text-sm">Ya no quedan horarios disponibles. Escribe a Recursos Humanos para coordinar otro.</p>;
  } else {
    body = (
      <BookingPicker
        token={token}
        slots={booking.slots.map((slot) => ({ id: slot.id, label: formatInterviewDateTime(slot.startsAt) }))}
      />
    );
  }

  const meetingUrl = booking?.modality === "virtual" ? safeHttpUrl(booking.location ?? "") : null;

  return (
    <main className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex justify-center">
          <BrandLogo className="h-7" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{booking ? booking.vacancyTitle : "Elige el horario de tu entrevista"}</h1>
            </CardTitle>
            <CardDescription>Entrevista con {company}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {booking ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Modalidad</dt>
                  <dd className="font-medium">{MODALITY[booking.modality] ?? booking.modality}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Duración aproximada</dt>
                  <dd className="font-medium">{formatDuration(booking.durationMinutes)}</dd>
                </div>
                {booking.location && booking.modality !== "virtual" ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">{booking.modality === "presencial" ? "Lugar" : "Indicación"}</dt>
                    <dd className="font-medium break-words">{booking.location}</dd>
                  </div>
                ) : null}
                {meetingUrl ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Enlace de la reunión</dt>
                    <dd className="font-medium break-all">{meetingUrl}</dd>
                  </div>
                ) : null}
                {booking.status === "pendiente" ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Puedes elegir hasta</dt>
                    <dd className="font-medium">{formatInterviewDateTime(booking.expiresAt)} (hora de Lima)</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {body}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
