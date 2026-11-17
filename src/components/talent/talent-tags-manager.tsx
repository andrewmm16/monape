"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { assignTalentTag, createTalentTag, removeTalentTag } from "@/modules/talent-pool/actions";
import type { TalentTag } from "@/modules/talent-pool/queries";
import { TalentTagBadge } from "./talent-tag-badge";

type Props = { candidateId: string; tags: TalentTag[]; allTags: TalentTag[] };

/** Gestión de las etiquetas de un candidato: quitar, asignar una existente o crear una nueva. */
export function TalentTagsManager({ candidateId, tags, allTags }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState("");
  const [newName, setNewName] = useState("");

  const assigned = new Set(tags.map((tag) => tag.id));
  const available = allTags.filter((tag) => !assigned.has(tag.id));

  const remove = (tagId: string) =>
    startTransition(async () => {
      const result = await removeTalentTag({ candidateId, tagId });
      if (result.ok) {
        toast.success("Etiqueta quitada.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const assign = () =>
    startTransition(async () => {
      if (!selected) return;
      const result = await assignTalentTag({ candidateId, tagId: selected });
      if (result.ok) {
        toast.success("Etiqueta asignada.");
        setSelected("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const create = () =>
    startTransition(async () => {
      const name = newName.trim();
      if (!name) return;
      const created = await createTalentTag({ name });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      const result = await assignTalentTag({ candidateId, tagId: created.data.id });
      if (result.ok) {
        toast.success("Etiqueta creada y asignada.");
        setNewName("");
      } else {
        toast.error(result.error);
      }
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este candidato aún no tiene etiquetas.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Etiquetas del candidato">
          {tags.map((tag) => (
            <li key={tag.id} className="flex items-center gap-1">
              <TalentTagBadge tag={tag} />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Quitar la etiqueta ${tag.name}`}
                disabled={pending}
                onClick={() => remove(tag.id)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="grid gap-1.5">
          <Label htmlFor="talent-tag-existing">Asignar una etiqueta existente</Label>
          <div className="flex gap-2">
            <NativeSelect id="talent-tag-existing" value={selected} onChange={(event) => setSelected(event.target.value)} className="min-w-0 flex-1">
              <NativeSelectOption value="">Seleccione una etiqueta</NativeSelectOption>
              {available.map((tag) => (
                <NativeSelectOption key={tag.id} value={tag.id}>
                  {tag.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button type="button" variant="outline" onClick={assign} disabled={!selected || pending}>
              Asignar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="talent-tag-new">Crear una etiqueta nueva</Label>
        <div className="flex gap-2">
          <Input
            id="talent-tag-new"
            value={newName}
            maxLength={40}
            placeholder="Ej.: Finalista 2026"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                create();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={create} disabled={!newName.trim() || pending}>
            Crear y asignar
          </Button>
        </div>
      </div>
    </div>
  );
}
