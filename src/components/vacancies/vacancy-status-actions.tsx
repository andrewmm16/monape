import { ActionButton } from "@/components/common/action-button";
import { changeVacancyStatus, deleteVacancy } from "@/modules/vacancies/actions";
import { VACANCY_TRANSITIONS } from "@/modules/vacancies/schemas";
import type { Enums } from "@/types/database";

// «publicada» no está aquí: se publica desde la sección visible de la pestaña
// Portales (grilla de portales + botón Publicar), no desde el encabezado.
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
}: {
  vacancyId: string;
  status: Enums<"vacancy_status">;
  canDelete: boolean;
}) {
  return (
    <>
      {VACANCY_TRANSITIONS[status].map((next) =>
        next === "publicada" ? null : (
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
      {canDelete && (status === "borrador" || status === "archivada") ? (
        <ActionButton
          variant="destructive"
          action={deleteVacancy.bind(null, vacancyId)}
          confirm={{
            title: status === "borrador" ? "¿Eliminar el borrador?" : "¿Eliminar la vacante archivada?",
            description:
              status === "borrador"
                ? "Solo se eliminan borradores sin postulaciones. Esta acción no se puede deshacer."
                : "Solo se eliminan vacantes archivadas sin postulaciones. Esta acción no se puede deshacer.",
            confirmLabel: "Eliminar",
          }}
        >
          {status === "borrador" ? "Eliminar borrador" : "Eliminar vacante"}
        </ActionButton>
      ) : null}
    </>
  );
}
