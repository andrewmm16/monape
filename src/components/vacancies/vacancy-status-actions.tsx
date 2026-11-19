import { ActionButton } from "@/components/common/action-button";
import { DeleteArchivedVacancyDialog } from "@/components/vacancies/delete-archived-vacancy-dialog";
import { changeVacancyStatus, deleteVacancy } from "@/modules/vacancies/actions";
import { VACANCY_TRANSITIONS } from "@/modules/vacancies/schemas";
import type { Enums } from "@/types/database";

// «publicada» no está aquí: se publica desde la sección visible de la pestaña
// Portales (grilla de portales + botón Publicar), no desde el encabezado.
const LABELS: Record<Exclude<Enums<"vacancy_status">, "publicada">, { label: string; description: string }> = {
  cerrada: { label: "Cerrar vacante", description: "No se podrán registrar nuevas postulaciones. Podrá reabrirla." },
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
  applicationCount,
}: {
  vacancyId: string;
  status: Enums<"vacancy_status">;
  canDelete: boolean;
  applicationCount: number;
}) {
  return (
    <>
      {VACANCY_TRANSITIONS[status].map((next) =>
        next === "publicada" ? null : (
          <ActionButton
            key={next}
            // Cerrar y archivar cortan la convocatoria: se distinguen de «Editar» (en rojo y con confirmación).
            variant={next === "borrador" ? "outline" : "destructive"}
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
          action={deleteVacancy.bind(null, vacancyId)}
          confirm={{
            title: "¿Eliminar el borrador?",
            description: "Solo se eliminan borradores sin postulaciones. Esta acción no se puede deshacer.",
            confirmLabel: "Eliminar",
          }}
        >
          Eliminar borrador
        </ActionButton>
      ) : null}
      {canDelete && status === "archivada" ? (
        <DeleteArchivedVacancyDialog vacancyId={vacancyId} applicationCount={applicationCount} />
      ) : null}
    </>
  );
}
