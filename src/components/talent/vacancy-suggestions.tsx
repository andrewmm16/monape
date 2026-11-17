"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TalentConsentBadge } from "@/components/talent/talent-consent-badge";
import { addCandidatesToVacancy, inviteCandidatesToVacancy } from "@/modules/talent-pool/actions";
import type { SuggestedCandidate } from "@/modules/talent-pool/matching";

type BatchAction = "invite" | "add";

/** Candidatos de la base que encajan con la vacante, con acciones en lote (invitar o añadir al proceso). */
export function VacancySuggestions({ vacancyId, candidates }: { vacancyId: string; candidates: SuggestedCandidate[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<BatchAction | null>(null);
  const [pending, startTransition] = useTransition();

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No encontramos candidatos de tu base que encajen con los requisitos de esta vacante.
      </p>
    );
  }

  const allSelected = selected.size === candidates.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(candidates.map((c) => c.id)) : new Set());
  const toggleOne = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = (action: BatchAction) =>
    startTransition(async () => {
      const candidateIds = [...selected];
      if (action === "invite") {
        const result = await inviteCandidatesToVacancy({ vacancyId, candidateIds });
        if (!result.ok) {
          toast.error(result.error);
        } else {
          const { invited, skippedNoEmail, skippedRevoked, failed } = result.data;
          toast.success(
            `${invited} invitados · ${skippedNoEmail} sin correo · ${skippedRevoked} sin consentimiento · ${failed} con error`,
          );
          setSelected(new Set());
          router.refresh();
        }
      } else {
        const result = await addCandidatesToVacancy({ vacancyId, candidateIds });
        if (!result.ok) {
          toast.error(result.error);
        } else {
          const { added, failed } = result.data;
          toast.success(
            `${added} añadidos` + (failed.length > 0 ? ` · ${failed.length} no se pudieron (${failed[0].reason})` : ""),
          );
          setSelected(new Set());
          router.refresh();
        }
      }
      setConfirming(null);
    });

  const count = selected.size;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={count === 0 || pending} onClick={() => setConfirming("invite")}>
          Invitar por correo
        </Button>
        <Button type="button" variant="outline" disabled={count === 0 || pending} onClick={() => setConfirming("add")}>
          Añadir al proceso
        </Button>
        <span className="text-sm text-muted-foreground">
          {count === 0 ? "Selecciona candidatos para actuar en lote." : `${count} seleccionados`}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                aria-label="Seleccionar todos"
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(value) => toggleAll(value === true)}
              />
            </TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead>Ubicación</TableHead>
            <TableHead>Coincidencias</TableHead>
            <TableHead>Consentimiento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => (
            <TableRow key={candidate.id}>
              <TableCell>
                <Checkbox
                  aria-label={`Seleccionar a ${candidate.full_name}`}
                  checked={selected.has(candidate.id)}
                  onCheckedChange={(value) => toggleOne(candidate.id, value === true)}
                />
              </TableCell>
              <TableCell>
                <div className="font-medium">{candidate.full_name}</div>
                {candidate.email === null ? <div className="text-xs text-muted-foreground">sin correo</div> : null}
              </TableCell>
              <TableCell>{candidate.location || "—"}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1" title={candidate.matchedTerms.join(", ")}>
                  <span className="font-medium">{candidate.matchCount}</span>
                  {candidate.matchedTerms.slice(0, 4).map((term) => (
                    <Badge key={term} variant="secondary" className="text-xs">
                      {term}
                    </Badge>
                  ))}
                  {candidate.matchedTerms.length > 4 ? (
                    <span className="text-xs text-muted-foreground">+{candidate.matchedTerms.length - 4}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <TalentConsentBadge state={candidate.consent} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => (!open && !pending ? setConfirming(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming === "invite" ? "Invitar por correo" : "Añadir al proceso"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "invite"
                ? `Se enviará un correo real a los ${count} candidatos seleccionados que tengan correo y consentimiento vigente.`
                : `Se añadirán ${count} candidatos seleccionados al proceso de esta vacante.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={() => confirming && run(confirming)}>
              {pending ? "Procesando…" : "Confirmar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
