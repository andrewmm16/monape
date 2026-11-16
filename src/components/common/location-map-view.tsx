"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
// Estilos de Leaflet desde el paquete (nada se carga de un CDN).
import "leaflet/dist/leaflet.css";

const ZOOM = 17;

/**
 * Mapa de OpenStreetMap con un punto. Solo se carga en el navegador (ver
 * location-map.tsx). El marcador es un divIcon: los iconos por defecto de
 * Leaflet usan imágenes cuyas rutas el empaquetador no resuelve.
 */
export default function LocationMapView({ lat, lng, label }: { lat: number; lng: number; label?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = L.map(element, { center: [lat, lng], zoom: ZOOM, scrollWheelZoom: false, attributionControl: true });
    instance.attributionControl.setPrefix(false);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(instance);
    marker.current = L.marker([lat, lng], {
      keyboard: false,
      icon: L.divIcon({
        className: "",
        html: '<span class="block size-4 rounded-full border-2 border-white bg-brand shadow-md ring-2 ring-brand/40"></span>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    }).addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      marker.current = null;
    };
    // El mapa se crea una vez; los cambios de punto se aplican en el efecto siguiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    marker.current?.setLatLng([lat, lng]);
    map.current?.setView([lat, lng], ZOOM);
  }, [lat, lng]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={label ? `Mapa: ${label}` : "Mapa con la ubicación de la entrevista"}
      className="z-0 h-[220px] w-full overflow-hidden rounded-lg border"
    />
  );
}
