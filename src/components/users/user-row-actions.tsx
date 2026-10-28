"use client";

import { useState } from "react";
import { ActionButton } from "@/components/common/action-button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/permissions";
import { deleteUser, updateUser } from "@/modules/users/actions";
import { Constants } from "@/types/database";

export function UserRowActions({ userId, role }: { userId: string; role: AppRole }) {
  const [selectedRole, setSelectedRole] = useState<AppRole>(role);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <NativeSelect
        size="sm"
        aria-label="Rol"
        value={selectedRole}
        onChange={(event) => setSelectedRole(event.target.value as AppRole)}
      >
        {Constants.public.Enums.app_role.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {ROLE_LABELS[option]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <ActionButton
        size="sm"
        variant="outline"
        disabled={selectedRole === role}
        action={() => updateUser({ userId, role: selectedRole })}
      >
        Cambiar rol
      </ActionButton>
      <ActionButton
        size="sm"
        variant="destructive"
        action={() => updateUser({ userId, isActive: false })}
        confirm={{
          title: "¿Desactivar usuario?",
          description:
            "La persona perderá el acceso de inmediato y pasará a la papelera, desde donde podrá reactivarla o eliminarla definitivamente. Sus registros y acciones previas se conservan.",
          confirmLabel: "Desactivar",
        }}
      >
        Desactivar
      </ActionButton>
    </div>
  );
}

export function TrashedUserActions({ userId }: { userId: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ActionButton
        size="sm"
        variant="outline"
        action={() => updateUser({ userId, isActive: true })}
        confirm={{
          title: "¿Reactivar usuario?",
          description: "La persona recuperará el acceso con su rol actual.",
          confirmLabel: "Reactivar",
        }}
      >
        Reactivar
      </ActionButton>
      <ActionButton
        size="sm"
        variant="destructive"
        action={() => deleteUser(userId)}
        confirm={{
          title: "¿Eliminar definitivamente?",
          description:
            "Se borrará la cuenta: correo, contraseña y acceso. Ese correo quedará libre para una nueva invitación. Su nombre se conservará en el historial con la marca «(eliminado)». Esta acción no se puede deshacer.",
          confirmLabel: "Eliminar",
        }}
      >
        Eliminar definitivamente
      </ActionButton>
    </div>
  );
}
