import { ActionButton } from "@/components/common/action-button";
import { changeVacancyStatus, deleteDraftVacancy } from "@/modules/vacancies/actions";
import { VACANCY_TRANSITIONS } from "@/modules/vacancies/schemas";
import type { Enums } from "@/types/database";

const LABELS: Record<Enums<"vacancy_status">, { label: string; description: string }> = {
  publicada: {
    label: "Publicar",
    description:
      "La vacante se publicará en la página pública, en Google y en los buscadores de empleo, salvo que sea confidencial.",
  },
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
}: {
  vacancyId: string;
  status: Enums<"vacancy_status">;
  canDelete: boolean;
}) {
  return (
    <>
      {VACANCY_TRANSITIONS[status].map((next) => (
        <ActionButton
          key={next}
          variant={next === "publicada" ? "default" : "outline"}
          action={changeVacancyStatus.bind(null, vacancyId, next)}
          confirm={{ title: `¿${LABELS[next].label}?`, description: LABELS[next].description, confirmLabel: LABELS[next].label }}
        >
          {LABELS[next].label}
        </ActionButton>
      ))}
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
