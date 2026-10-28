"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ACTIVITY_ENDPOINT,
  ACTIVITY_REPORT_INTERVAL_MS,
  IDLE_SIGN_OUT_PATH,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
} from "@/lib/auth/inactivity";
import { signOut } from "@/modules/auth/actions";

// Última actividad compartida por todas las pestañas (hora del navegador).
const STORAGE_KEY = "sesion-ultima-actividad";
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;

// Respaldo cuando el navegador no permite usar localStorage.
let memoryLastActivity = 0;

function readLastActivity(): number {
  try {
    return Math.max(memoryLastActivity, Number(localStorage.getItem(STORAGE_KEY)) || 0);
  } catch {
    return memoryLastActivity;
  }
}

function writeLastActivity(time: number) {
  memoryLastActivity = time;
  try {
    localStorage.setItem(STORAGE_KEY, String(time));
  } catch {
    // Sin almacenamiento: la actividad solo cuenta en esta pestaña.
  }
}

/**
 * Cierra la sesión tras 30 minutos sin actividad. Durante el último minuto
 * muestra «¿Sigue ahí?» con una cuenta regresiva; con el aviso abierto solo
 * cuenta la respuesta del usuario. Ver lib/auth/inactivity.ts.
 */
export function InactivityGuard({ serverIdleMs }: { serverIdleMs: number }) {
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const warningShown = useRef(false);
  const lastRegistered = useRef(0);
  const lastReported = useRef(0);
  const leaving = useRef(false);
  const signOutForm = useRef<HTMLFormElement>(null);
  const nextField = useRef<HTMLInputElement>(null);

  // La actividad que conoce el servidor descarta valores antiguos de una sesión anterior.
  useEffect(() => {
    writeLastActivity(Math.max(readLastActivity(), Date.now() - serverIdleMs));
  }, [serverIdleMs]);

  const registerActivity = useCallback((immediate = false) => {
    const now = Date.now();
    // El movimiento del mouse dispara decenas de eventos por segundo.
    if (!immediate && now - lastRegistered.current < 1_000) return;
    lastRegistered.current = now;
    writeLastActivity(now);

    if (!immediate && now - lastReported.current < ACTIVITY_REPORT_INTERVAL_MS) return;
    lastReported.current = now;
    fetch(ACTIVITY_ENDPOINT, { method: "POST", cache: "no-store" })
      .then((response) => {
        // La sesión ya no existe en el servidor (vencida o cerrada en otra pestaña).
        if (response.status === 401) window.location.reload();
      })
      .catch(() => {
        // Sin conexión: se reintenta en el siguiente intervalo con actividad.
      });
  }, []);

  useEffect(() => {
    const onActivity = () => {
      if (warningShown.current) return;
      // Al volver de una suspensión, un clic no reabre una sesión ya vencida.
      if (Date.now() - readLastActivity() >= IDLE_TIMEOUT_MS) return tick();
      registerActivity();
    };
    const tick = () => {
      if (leaving.current) return;
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - readLastActivity());
      if (remaining <= 0) {
        leaving.current = true;
        if (nextField.current) nextField.current.value = `${window.location.pathname}${window.location.search}`;
        signOutForm.current?.requestSubmit();
        return;
      }
      warningShown.current = remaining <= IDLE_WARNING_MS;
      setWarningOpen(warningShown.current);
      if (warningShown.current) setSecondsLeft(Math.ceil(remaining / 1_000));
    };

    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { capture: true, passive: true });
    // Los navegadores ralentizan los temporizadores de las pestañas en segundo plano.
    document.addEventListener("visibilitychange", tick);
    const interval = window.setInterval(tick, 1_000);
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", tick);
      window.clearInterval(interval);
    };
  }, [registerActivity]);

  const stayConnected = () => {
    warningShown.current = false;
    setWarningOpen(false);
    registerActivity(true);
  };

  return (
    <>
      <form ref={signOutForm} method="post" action={IDLE_SIGN_OUT_PATH} hidden>
        <input ref={nextField} type="hidden" name="next" />
      </form>
      <AlertDialog open={warningOpen} onOpenChange={(open) => !open && stayConnected()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Sigue ahí?</AlertDialogTitle>
            <AlertDialogDescription>
              Por seguridad, su sesión se cerrará por inactividad en {secondsLeft}{" "}
              {secondsLeft === 1 ? "segundo" : "segundos"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <form action={signOut}>
              <Button type="submit" variant="outline" className="w-full">
                Cerrar sesión
              </Button>
            </form>
            {/* Cancelar el cierre es la acción por defecto: recibe el foco al abrir. */}
            <AlertDialogCancel variant="default">Seguir conectado</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
