import { parseAddressQuery } from "./address-query";

const PHOTON_URL = "https://photon.komoot.io/api/";
/** Photon pide identificar la aplicación en cada solicitud. */
const USER_AGENT = "IterruptivoReclutamiento/1.0 (autocompletado de direcciones de entrevistas)";
const TIMEOUT_MS = 5_000;
const RESULT_LIMIT = 5;
/** Se pide de más: varios tramos de una misma calle dan el mismo texto y se quedan en uno. */
const PHOTON_LIMIT = 15;
/** Sesgo hacia Lima: las direcciones de las entrevistas suelen estar allí. */
const BIAS = { lat: -12.05, lon: -77.04 };
/** Recuadro de Perú (oeste, sur, este, norte). Toca países vecinos: por eso también se filtra por país. */
const PERU_BBOX = "-81.5,-18.5,-68.5,0.1";

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

export type PlaceSuggestion = {
  label: string;
  lat: number;
  lng: number;
  /** Se escribió una numeración que el mapa no tiene: el punto marca la vía, no el número. */
  approximate?: boolean;
};

type PhotonFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
};

// Caché en memoria por consulta a Photon: al ir escribiendo el número, la búsqueda de
// la calle ya está hecha y no se repite.
const cache = new Map<string, { expires: number; features: PhotonFeature[] }>();

function cacheGet(key: string, now: number): PhotonFeature[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= now) {
    cache.delete(key);
    return null;
  }
  return hit.features;
}

function cacheSet(key: string, features: PhotonFeature[], now: number) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    // Si todo sigue vigente, se descarta la entrada más antigua.
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, { expires: now + CACHE_TTL_MS, features });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Vías y zonas: lo único a lo que tiene sentido añadirle una numeración. */
function isAddressable(properties: Record<string, unknown>): boolean {
  return ["street", "locality", "district"].includes(text(properties.type));
}

/**
 * Nombre, calle y número, distrito, ciudad, estado y país, sin partes repetidas.
 * `suffix` es la numeración que escribió la persona: va tras el nombre de la vía.
 */
function labelOf(properties: Record<string, unknown>, suffix: string | null, interior: string | null): string {
  const name = text(properties.name);
  const housenumber = text(properties.housenumber);
  const street = [text(properties.street), housenumber, housenumber ? interior : null].filter(Boolean).join(" ");
  const head = suffix && !housenumber && isAddressable(properties) ? `${name} ${suffix}`.trim() : name;
  const parts = [head, street, text(properties.district), text(properties.city), text(properties.state), text(properties.country)];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!part || seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique.join(", ");
}

function coordinatesOf(feature: PhotonFeature): { lat: number; lng: number } | null {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const [lng, lat] = coordinates;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function photon(query: string): Promise<PhotonFeature[]> {
  const now = Date.now();
  const key = query.toLowerCase();
  const cached = cacheGet(key, now);
  if (cached) return cached;

  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(PHOTON_LIMIT));
  url.searchParams.set("lat", String(BIAS.lat));
  url.searchParams.set("lon", String(BIAS.lon));
  url.searchParams.set("bbox", PERU_BBOX);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Photon respondió ${response.status}`);
  const features = ((await response.json()) as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error("Respuesta de Photon sin 'features'");
  const inPeru = (features as PhotonFeature[]).filter((feature) => {
    const country = text(feature?.properties?.countrycode);
    return !country || country.toUpperCase() === "PE";
  });
  cacheSet(key, inPeru, now);
  return inPeru;
}

/**
 * Sugerencias para una dirección escrita a mano, en este orden:
 * 1. La casa exacta, si el mapa tiene ese número. Si la hay, no hace falta más.
 * 2. La vía, con la numeración escrita añadida al texto (y marcada como aproximada).
 * 3. La vía sin su tipo, porque en el mapa muchas calles se llaman solo «Los Zafiros».
 */
export async function searchPlaces(raw: string): Promise<PlaceSuggestion[]> {
  const query = parseAddressQuery(raw);
  const places = new Map<string, PlaceSuggestion>();

  const add = (features: PhotonFeature[], exact: boolean) => {
    for (const feature of features) {
      const coordinates = coordinatesOf(feature);
      if (!coordinates) continue;
      const label = labelOf(feature.properties ?? {}, exact ? null : query.suffix, query.interior);
      if (!label || places.has(label)) continue;
      places.set(label, { label, ...coordinates, ...(query.suffix && !exact ? { approximate: true } : {}) });
    }
  };

  if (query.houseNumber) {
    const wanted = query.houseNumber.toLowerCase();
    add((await photon(query.full)).filter((feature) => text(feature.properties?.housenumber).toLowerCase() === wanted), true);
    if (places.size > 0) return [...places.values()].slice(0, RESULT_LIMIT);
  }

  // Solo «Mz. B» o «Dpto. 401», sin vía: no hay nada que buscar.
  if (query.street.length < 3) return [];

  // Con numeración escrita, los comercios y las casas con otro número de esa calle solo estorban.
  const onlyAddressable = (features: PhotonFeature[]) => features.filter((feature) => isAddressable(feature.properties ?? {}));
  const streets = await photon(query.street);
  add(query.suffix ? onlyAddressable(streets) : streets, false);
  if (query.name && places.size < RESULT_LIMIT) add(onlyAddressable(await photon(query.name)), false);

  return [...places.values()].slice(0, RESULT_LIMIT);
}
