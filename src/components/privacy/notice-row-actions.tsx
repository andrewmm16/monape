"use client";

import { ActionButton } from "@/components/common/action-button";
import { NoticeActivateDialog } from "@/components/privacy/notice-activate-dialog";
import { NoticeEditorDialog } from "@/components/privacy/notice-editor-dialog";
import { NoticeText } from "@/components/privacy/notice-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteNotice } from "@/modules/privacy/actions";
import type { Enums } from "@/types/database";

type Notice = { id: string; version: number; title: string; body: string; status: Enums<"privacy_notice_status"> };

/** Borrador: ver, editar, activar y eliminar. Vigente o retirada: solo lectura. */
export function NoticeRowActions({ notice }: { notice: Notice }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" type="button">
            Ver texto
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Versión {notice.version} · {notice.title}
            </DialogTitle>
            <DialogDescription>Vista previa en texto plano.</DialogDescription>
          </DialogHeader>
          <NoticeText text={notice.body} />
        </DialogContent>
      </Dialog>
      {notice.status === "borrador" ? (
        <>
          <NoticeEditorDialog
            noticeId={notice.id}
            initialValues={{ title: notice.title, body: notice.body }}
            trigger={
              <Button size="sm" variant="outline" type="button">
                Editar
              </Button>
            }
          />
          <NoticeActivateDialog noticeId={notice.id} version={notice.version} />
          <ActionButton
            size="sm"
            variant="destructive"
            action={() => deleteNotice(notice.id)}
            confirm={{
              title: `¿Eliminar el borrador de la versión ${notice.version}?`,
              description: "El borrador se elimina de forma definitiva.",
              confirmLabel: "Eliminar",
            }}
          >
            Eliminar
          </ActionButton>
        </>
      ) : null}
    </div>
  );
}
