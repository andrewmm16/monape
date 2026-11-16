"use client";

import dynamic from "next/dynamic";

// Leaflet necesita `window`: el mapa se carga solo en el navegador.
const LocationMapView = dynamic(() => import("./location-map-view"), {
  ssr: false,
  loading: () => <div className="h-[220px] w-full animate-pulse rounded-lg border bg-muted" aria-hidden />,
});

/** Enlace a OpenStreetMap con el punto marcado. */
export function openStreetMapUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** Mapa pequeño (~220 px) con el punto exacto y el enlace «Abrir en OpenStreetMap». */
export function LocationMap({ lat, lng, label }: { lat: number; lng: number; label?: string }) {
  return (
    <div className="space-y-1">
      <LocationMapView lat={lat} lng={lng} label={label} />
      <a
        href={openStreetMapUrl(lat, lng)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-brand underline underline-offset-2"
      >
        Abrir en OpenStreetMap
      </a>
    </div>
  );
}
