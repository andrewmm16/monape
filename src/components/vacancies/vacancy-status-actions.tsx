import { ActionButton } from "@/components/common/action-button";
import { PublishVacancyButton } from "@/components/vacancies/publish-vacancy-button";
import { changeVacancyStatus, deleteDraftVacancy } from "@/modules/vacancies/actions";
import { VACANCY_TRANSITIONS } from "@/modules/vacancies/schemas";
import type { Enums } from "@/types/database";

// «publicada» no está aquí: se publica con PublishVacancyButton.
const LABELS: Record<Exclude<Enums<"vacancy_status">, "publicada">, { label: string; description: string }> = {
  cerrada: { label: "Cerrar", description: "No se podrán registrar nuevas postulaciones. Podrá reabrirla." },
  archivada: {
    label: "Archivar",
    description: "La vacante dejará de mostrarse en los listados. Esta acción no puede deshacerse desde la aplicación.",
  },
  borrador: { label: "Volver a borrador", description: "" },
};

export function VacancyStatusActions({
  vacancyId,
  status,
  canDelete,
  portals,
  blockers,
}: {
  vacancyId: string;
  status: Enums<"vacancy_status">;
  canDelete: boolean;
  /** Portales que el robot atiende, para elegirlos al publicar. */
  portals: { id: string; name: string }[];
  /** Lo que falta para poder publicar (vacío si ya puede). */
  blockers: string[];
}) {
  return (
    <>
      {VACANCY_TRANSITIONS[status].map((next) =>
        next === "publicada" ? (
          <PublishVacancyButton key={next} vacancyId={vacancyId} portals={portals} blockers={blockers} reopen={status === "cerrada"} />
        ) : (
          <ActionButton
            key={next}
            variant="outline"
            action={changeVacancyStatus.bind(null, vacancyId, next)}
            confirm={{ title: `¿${LABELS[next].label}?`, description: LABELS[next].description, confirmLabel: LABELS[next].label }}
          >
            {LABELS[next].label}
          </ActionButton>
        ),
      )}
      {canDelete && status === "borrador" ? (
        <ActionButton
          variant="destructive"
          action={deleteDraftVacancy.bind(null, vacancyId)}
          confirm={{
            title: "¿Eliminar el borrador?",
            description: "Solo se eliminan borradores sin postulaciones. Esta acción no se puede deshacer.",
            confirmLabel: "Eliminar",
          }}
        >
          Eliminar borrador
        </ActionButton>
      ) : null}
    </>
  );
}
