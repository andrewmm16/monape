import { CheckCircle2Icon, PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { ActionButton } from "@/components/common/action-button";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { REQUIREMENT_CATEGORY_LABELS, REQUIREMENT_PRIORITY_LABELS } from "@/lib/labels";
import { approveCriteria, deleteRequirement } from "@/modules/vacancies/actions";
import type { Tables } from "@/types/database";
import { RequirementDialog } from "./requirement-dialog";

type Props = {
  vacancy: Pick<Tables<"vacancies">, "id" | "criteria_version" | "criteria_approved_at"> & {
    approver: { full_name: string } | null;
  };
  requirements: Tables<"vacancy_requirements">[];
  canManage: boolean;
};

export function RequirementsPanel({ vacancy, requirements, canManage }: Props) {
  const totalWeight = requirements.reduce((sum, r) => sum + r.weight, 0);
  const approved = Boolean(vacancy.criteria_approved_at);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Requisitos y criterios de evaluación</CardTitle>
          <CardDescription>
            El peso de cada requisito se expresa como porcentaje del total. Todos los candidatos se evalúan con la misma
            versión aprobada.
          </CardDescription>
          {approved ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2Icon className="size-4" aria-hidden />
              Versión {vacancy.criteria_version} aprobada
              {vacancy.approver ? ` por ${vacancy.approver.full_name}` : ""} el {formatDateTime(vacancy.criteria_approved_at)}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon className="size-4" aria-hidden />
              {vacancy.criteria_version > 0
                ? `Hay cambios sin aprobar (última versión aprobada: ${vacancy.criteria_version}).`
                : "Criterios pendientes de aprobación."}{" "}
              No se pueden evaluar candidatos hasta aprobarlos.
            </p>
          )}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <RequirementDialog
              vacancyId={vacancy.id}
              trigger={
                <Button variant="outline">
                  <PlusIcon /> Agregar requisito
                </Button>
              }
            />
            {!approved ? (
              <ActionButton
                action={approveCriteria.bind(null, vacancy.id)}
                disabled={requirements.length === 0}
                confirm={{
                  title: "¿Aprobar los criterios?",
                  description:
                    "Confirme que revisó los requisitos y sus pesos, y que se relacionan con las funciones del puesto. Se creará una nueva versión de criterios.",
                  confirmLabel: "Aprobar criterios",
                }}
              >
                Aprobar criterios
              </ActionButton>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {requirements.length === 0 ? (
          <EmptyState
            title="Sin requisitos"
            description="Agregue formación, experiencia, habilidades, herramientas, certificaciones y competencias relevantes para el puesto."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requisito</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead className="text-right">Peso</TableHead>
                {canManage ? <TableHead className="w-24 text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((requirement) => (
                <TableRow key={requirement.id}>
                  <TableCell className="max-w-md whitespace-normal">
                    <div className="font-medium">{requirement.description}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {requirement.is_essential ? <Badge variant="outline">Legal o esencial</Badge> : null}
                      {requirement.min_years !== null ? (
                        <Badge variant="outline">Mínimo {requirement.min_years} años</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {requirement.keywords.length > 0
                        ? `Términos: ${requirement.keywords.join(", ")}`
                        : "Sin términos de búsqueda: requiere revisión manual"}
                    </div>
                  </TableCell>
                  <TableCell>{REQUIREMENT_CATEGORY_LABELS[requirement.category]}</TableCell>
                  <TableCell>{REQUIREMENT_PRIORITY_LABELS[requirement.priority]}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {requirement.weight}
                    <div className="text-xs text-muted-foreground">
                      {totalWeight > 0 ? `${Math.round((requirement.weight / totalWeight) * 100)} %` : "—"}
                    </div>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <RequirementDialog
                          vacancyId={vacancy.id}
                          requirementId={requirement.id}
                          initialValues={{
                            category: requirement.category,
                            priority: requirement.priority,
                            description: requirement.description,
                            keywords: requirement.keywords.join(", "),
                            weight: requirement.weight,
                            minYears: requirement.min_years === null ? "" : String(requirement.min_years),
                            isEssential: requirement.is_essential,
                          }}
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label="Editar requisito">
                              <PencilIcon />
                            </Button>
                          }
                        />
                        <ActionButton
                          variant="ghost"
                          size="icon-sm"
                          action={deleteRequirement.bind(null, vacancy.id, requirement.id)}
                          confirm={{
                            title: "¿Eliminar requisito?",
                            description: "Las evaluaciones anteriores conservan su copia del requisito. Deberá aprobar nuevamente los criterios.",
                            confirmLabel: "Eliminar",
                          }}
                        >
                          <Trash2Icon aria-label="Eliminar requisito" />
                        </ActionButton>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
