"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PlaceSuggestion = { label: string; lat: number; lng: number; approximate?: boolean };

const MIN_CHARS = 3;
const DEBOUNCE_MS = 400;
/** Un poco más que el límite del servidor (una búsqueda por segundo). */
const RATE_LIMIT_RETRY_MS = 1_100;

type Status = "idle" | "loading" | "empty" | "error";

/**
 * Campo de dirección con sugerencias mientras se escribe (OpenStreetMap, vía
 * /api/lugares/buscar: el navegador nunca llama al proveedor). Combobox
 * accesible: flechas para moverse, Enter para elegir, Escape para cerrar.
 *
 * - Escribir llama a `onTextChange` (el padre borra las coordenadas).
 * - Elegir una sugerencia llama a `onSelect` con el texto y el punto.
 * - Si el servicio falla, el campo sigue siendo un texto libre.
 */
export function AddressAutocomplete({
  id,
  value,
  onTextChange,
  onSelect,
  onOpenChange,
  placeholder,
  invalid,
  describedBy,
  onBlur,
}: {
  id: string;
  value: string;
  onTextChange: (text: string) => void;
  onSelect: (place: PlaceSuggestion) => void;
  /** Avisa cuando la lista se abre o se cierra (para que Escape cierre solo la lista dentro de un diálogo). */
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  onBlur?: () => void;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const searchRef = useRef<(query: string) => Promise<void>>(async () => {});

  const setListOpen = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const cancelPending = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  const search = useCallback(
    async (query: string) => {
      const request = new AbortController();
      controller.current = request;
      setStatus("loading");
      try {
        const response = await fetch(`/api/lugares/buscar?q=${encodeURIComponent(query)}`, { signal: request.signal });
        // 429: se escribió muy rápido. Se reintenta: si no, lo último escrito (el número,
        // por ejemplo) se quedaría sin buscar. Escribir de nuevo cancela este reintento.
        if (response.status === 429) {
          timer.current = setTimeout(() => void searchRef.current(query), RATE_LIMIT_RETRY_MS);
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const places = (await response.json()) as PlaceSuggestion[];
        setSuggestions(places);
        setActive(-1);
        setStatus(places.length === 0 ? "empty" : "idle");
        setListOpen(places.length > 0);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSuggestions([]);
        setStatus("error");
        setListOpen(false);
      }
    },
    [setListOpen],
  );

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  function handleChange(text: string) {
    onTextChange(text);
    cancelPending();
    setActive(-1);
    // Las sugerencias llevan la numeración escrita: las de hace un momento ya no valen
    // («…Zafiros 20» cuando ya se escribió 2023) y no deben poder elegirse.
    setSuggestions([]);
    setStatus("idle");
    setListOpen(false);
    const query = text.trim();
    if (query.length < MIN_CHARS) return;
    timer.current = setTimeout(() => void search(query), DEBOUNCE_MS);
  }

  function choose(place: PlaceSuggestion) {
    cancelPending();
    onSelect(place);
    setSuggestions([]);
    setStatus("idle");
    setActive(-1);
    setListOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      event.preventDefault();
      if (!open) setListOpen(true);
      const last = suggestions.length - 1;
      setActive((current) =>
        event.key === "ArrowDown" ? (current >= last ? 0 : current + 1) : current <= 0 ? last : current - 1,
      );
    } else if (event.key === "Enter") {
      // Con la lista abierta, Enter elige y no envía el formulario.
      if (open && active >= 0 && suggestions[active]) {
        event.preventDefault();
        choose(suggestions[active]);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setListOpen(false);
    }
  }

  const activeId = open && active >= 0 ? `${listId}-option-${active}` : undefined;

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setListOpen(false);
          onBlur?.();
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Direcciones sugeridas"
        hidden={!open}
        className="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
      >
        {suggestions.map((place, index) => (
          <li
            key={`${place.lat},${place.lng},${place.label}`}
            id={`${listId}-option-${index}`}
            role="option"
            aria-selected={index === active}
            // mousedown evita que el campo pierda el foco antes de elegir.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(place)}
            onMouseEnter={() => setActive(index)}
            className={cn("cursor-pointer rounded-md px-2 py-1.5", index === active && "bg-accent text-accent-foreground")}
          >
            {place.label}
          </li>
        ))}
      </ul>
      <p role="status" className="mt-1 text-xs text-muted-foreground empty:hidden">
        {status === "loading"
          ? "Buscando direcciones…"
          : status === "empty"
            ? "Sin sugerencias. Puede escribir la dirección completa a mano."
            : status === "error"
              ? "No se pudieron cargar sugerencias. Escriba la dirección a mano; se guardará sin mapa."
              : null}
      </p>
    </div>
  );
}
