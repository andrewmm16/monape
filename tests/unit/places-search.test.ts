import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/lugares/buscar: sesión de personal, validación de q, consulta a
 * Photon desde el servidor (fetch simulado), caché de 5 minutos y límite de
 * ritmo por usuario. Nunca se llama a la red real.
 */

const session = vi.hoisted(() => ({ error: null as "unauthenticated" | "forbidden" | null, userId: "u-1" }));

vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => {
    if (session.error) {
      // Importación dinámica: tras vi.resetModules, la misma clase que usa la ruta.
      const { AppError } = await import("@/lib/errors");
      throw new AppError("Sin acceso.", session.error);
    }
    return { id: session.userId, email: "a@ejemplo.test", fullName: "Persona Ficticia", role: "rrhh" };
  },
}));

const photon = {
  features: [
    {
      geometry: { type: "Point", coordinates: [-77.0428, -12.0464] },
      properties: { name: "Plaza San Martín", city: "Lima", state: "Lima", country: "Perú" },
    },
    {
      geometry: { type: "Point", coordinates: [-77.03, -12.1] },
      properties: { street: "Avenida Larco", housenumber: "345", city: "Miraflores", state: "Lima", country: "Perú" },
    },
    // Sin coordenadas: se omite.
    { properties: { name: "Sin punto", city: "Lima" } },
    // Nombre repetido en la ciudad: no se duplica.
    { geometry: { coordinates: [-77.05, -12.06] }, properties: { name: "Lima", city: "Lima", country: "Perú" } },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

async function call(q: string | null) {
  // Módulo nuevo en cada prueba: caché y límite de ritmo en blanco.
  const { GET } = await import("@/app/api/lugares/buscar/route");
  const url = new URL("http://localhost:3000/api/lugares/buscar");
  if (q !== null) url.searchParams.set("q", q);
  return GET(new NextRequest(url));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
  session.error = null;
  session.userId = "u-1";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/lugares/buscar", () => {
  it("devuelve label, lat y lng; omite resultados sin coordenadas y arma el label sin repetir partes", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(photon));
    const response = await call("plaza san martin");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { label: "Plaza San Martín, Lima, Perú", lat: -12.0464, lng: -77.0428 },
      { label: "Avenida Larco 345, Miraflores, Lima, Perú", lat: -12.1, lng: -77.03 },
      { label: "Lima, Perú", lat: -12.06, lng: -77.05 },
    ]);
  });

  it("consulta Photon desde el servidor con User-Agent, sesgo hacia Lima y recuadro de Perú", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(photon));
    await call("  Av.   Larco 345 ");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api/");
    expect(url.searchParams.get("q")).toBe("Avenida Larco 345");
    expect(url.searchParams.get("limit")).toBe("15");
    expect(url.searchParams.get("lat")).toBe("-12.05");
    expect(url.searchParams.get("lon")).toBe("-77.04");
    expect(url.searchParams.get("bbox")).toBe("-81.5,-18.5,-68.5,0.1");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/^IterruptivoReclutamiento[/]/);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  describe("numeración y abreviaturas", () => {
    const street = (name: string, coordinates: [number, number], city = "San Juan de Lurigancho") => ({
      geometry: { coordinates },
      properties: { type: "street", name, district: city, city, state: "Lima", country: "Perú", countrycode: "PE" },
    });
    /** Photon simulado: responde según la consulta exacta que recibe. */
    function photonAnswers(answers: Record<string, unknown[]>) {
      fetchMock.mockImplementation(async (input) => {
        const q = new URL(String(input)).searchParams.get("q")!;
        return jsonResponse({ features: answers[q] ?? [] });
      });
    }
    const queries = () => fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("q"));

    it("conserva el número cuando el mapa solo tiene la calle, y avisa de que el punto es aproximado", async () => {
      photonAnswers({
        "jiron los zafiros 2023": [street("Jirón Los Zafiros", [-77.008, -11.998])],
        "jiron los zafiros": [street("Jirón Los Zafiros", [-77.008, -11.998])],
      });
      const response = await call("jiron los zafiros 2023");
      expect(await response.json()).toEqual([
        {
          label: "Jirón Los Zafiros 2023, San Juan de Lurigancho, Lima, Perú",
          lat: -11.998,
          lng: -77.008,
          approximate: true,
        },
      ]);
    });

    it("entiende «jr»: busca «Jirón» y conserva el número", async () => {
      photonAnswers({ "Jirón los zafiros": [street("Jirón Los Zafiros", [-77.008, -11.998])] });
      const body = (await (await call("jr los zafiros 2023")).json()) as { label: string }[];
      expect(queries()).toContain("Jirón los zafiros 2023");
      expect(body[0]!.label).toBe("Jirón Los Zafiros 2023, San Juan de Lurigancho, Lima, Perú");
    });

    it("si el mapa tiene esa casa, la devuelve sola, sin marcarla como aproximada y sin más consultas", async () => {
      const house = (number: string) => ({
        geometry: { coordinates: [-77.03, -12.05] },
        properties: { type: "house", street: "Jirón de la Unión", housenumber: number, city: "Lima", country: "Perú", countrycode: "PE" },
      });
      photonAnswers({ "Jirón de la Unión 500": [house("500"), house("500"), house("620")] });
      const response = await call("jr de la Unión 500");
      expect(await response.json()).toEqual([{ label: "Jirón de la Unión 500, Lima, Perú", lat: -12.05, lng: -77.03 }]);
      expect(queries()).toEqual(["Jirón de la Unión 500"]);
    });

    it("la casa exacta conserva el departamento escrito", async () => {
      photonAnswers({
        "Avenida Larco 345": [
          {
            geometry: { coordinates: [-77.03, -12.1] },
            properties: { type: "house", street: "Avenida Larco", housenumber: "345", city: "Miraflores", country: "Perú" },
          },
        ],
      });
      const body = (await (await call("av Larco 345 dpto 401")).json()) as { label: string }[];
      expect(body[0]!.label).toBe("Avenida Larco 345 Dpto. 401, Miraflores, Perú");
    });

    it("también busca la vía sin su tipo: en el mapa muchas calles se llaman solo «Los Zafiros»", async () => {
      photonAnswers({
        "Jirón los zafiros": [street("Jirón Los Zafiros", [-77.008, -11.998])],
        "los zafiros": [street("Los Zafiros", [-77.025, -12.08], "La Victoria"), street("Jirón Los Zafiros", [-77.008, -11.998])],
      });
      const body = (await (await call("jr los zafiros")).json()) as { label: string; approximate?: boolean }[];
      expect(body.map((place) => place.label)).toEqual([
        "Jirón Los Zafiros, San Juan de Lurigancho, Lima, Perú",
        "Los Zafiros, La Victoria, Lima, Perú",
      ]);
      // Sin numeración escrita no hay nada aproximado que avisar.
      expect(body.every((place) => place.approximate === undefined)).toBe(true);
    });

    it("con numeración escrita omite comercios y casas con otro número de la misma calle", async () => {
      photonAnswers({
        "Avenida Arequipa": [
          street("Avenida Arequipa", [-77.03, -12.08], "Lince"),
          {
            geometry: { coordinates: [-77.03, -12.09] },
            properties: { type: "house", name: "Iglesia", street: "Avenida Arequipa", housenumber: "2356", city: "Lince", countrycode: "PE" },
          },
        ],
      });
      const body = (await (await call("av Arequipa 2450")).json()) as { label: string }[];
      expect(body.map((place) => place.label)).toEqual(["Avenida Arequipa 2450, Lince, Lima, Perú"]);
    });

    it("manzana y lote quedan en el texto, sin mandarlos al buscador", async () => {
      photonAnswers({
        "Asentamiento Humano San Pedro": [
          {
            geometry: { coordinates: [-77, -12] },
            properties: { type: "locality", name: "Asentamiento Humano San Pedro", city: "San Juan de Lurigancho", country: "Perú", countrycode: "PE" },
          },
        ],
      });
      const body = (await (await call("aa.hh. San Pedro mz b lt 5")).json()) as { label: string; approximate?: boolean }[];
      expect(body[0]).toMatchObject({
        label: "Asentamiento Humano San Pedro Mz. B Lt. 5, San Juan de Lurigancho, Perú",
        approximate: true,
      });
      expect(queries()).not.toContain("Asentamiento Humano San Pedro mz b lt 5");
    });

    it("no devuelve resultados de otro país aunque caigan en el recuadro, y une los tramos repetidos", async () => {
      photonAnswers({
        "Avenida Larco": [
          street("Avenida Larco", [-77.03, -12.1], "Miraflores"),
          street("Avenida Larco", [-77.03, -12.11], "Miraflores"),
          {
            geometry: { coordinates: [-78, -2] },
            properties: { type: "street", name: "Avenida Larco", city: "Loja", country: "Ecuador", countrycode: "EC" },
          },
        ],
      });
      const body = (await (await call("av Larco")).json()) as { label: string }[];
      expect(body.map((place) => place.label)).toEqual(["Avenida Larco, Miraflores, Lima, Perú"]);
    });

    it("solo una manzana, sin vía: no consulta nada y no falla", async () => {
      const response = await call("mz b lt 5");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("al ir escribiendo el número no repite la búsqueda de la calle", async () => {
      photonAnswers({ "Jirón los zafiros": [street("Jirón Los Zafiros", [-77.008, -11.998])] });
      await call("jr los zafiros 20");
      vi.setSystemTime(new Date("2026-11-03T15:00:02Z"));
      session.userId = "u-2";
      const { GET } = await import("@/app/api/lugares/buscar/route");
      await GET(new NextRequest("http://localhost:3000/api/lugares/buscar?q=jr%20los%20zafiros%202023"));
      expect(queries().filter((q) => q === "Jirón los zafiros")).toHaveLength(1);
    });
  });

  it("proveedor caído, con error HTTP o con respuesta inválida: 502 con mensaje genérico", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 1.2.3.4"));
    const down = await call("larco 345");
    expect(down.status).toBe(502);
    const body = (await down.json()) as { error: string };
    expect(body.error).not.toMatch(/ECONNREFUSED|1\.2\.3\.4/);

    vi.resetModules();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "boom" }, 503));
    expect((await call("larco 345")).status).toBe(502);

    vi.resetModules();
    fetchMock.mockResolvedValueOnce(jsonResponse({ otra: "cosa" }));
    expect((await call("larco 345")).status).toBe(502);
  });

  it("q demasiado corta, ausente o demasiado larga: 400 sin consultar al proveedor", async () => {
    expect((await call("ab")).status).toBe(400);
    expect((await call("  a  ")).status).toBe(400);
    expect((await call(null)).status).toBe(400);
    expect((await call("x".repeat(201))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin sesión: 401; sin permiso: 403; en ambos casos no consulta al proveedor", async () => {
    session.error = "unauthenticated";
    expect((await call("larco 345")).status).toBe(401);
    vi.resetModules();
    session.error = "forbidden";
    expect((await call("larco 345")).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limita a una solicitud por segundo por usuario (otro usuario no se ve afectado)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(photon));
    const { GET } = await import("@/app/api/lugares/buscar/route");
    const request = (q: string) => new NextRequest(`http://localhost:3000/api/lugares/buscar?q=${encodeURIComponent(q)}`);

    expect((await GET(request("larco 345"))).status).toBe(200);
    const limited = await GET(request("larco 346"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("1");

    session.userId = "u-2";
    expect((await GET(request("larco 347"))).status).toBe(200);

    session.userId = "u-1";
    vi.setSystemTime(new Date("2026-11-03T15:00:01.100Z"));
    expect((await GET(request("larco 348"))).status).toBe(200);
  });

  it("cachea 5 minutos por consulta normalizada y vuelve a consultar al vencer", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(photon));
    const { GET } = await import("@/app/api/lugares/buscar/route");
    const request = (q: string) => new NextRequest(`http://localhost:3000/api/lugares/buscar?q=${encodeURIComponent(q)}`);

    expect((await GET(request("Av. Larco 345"))).status).toBe(200);
    vi.setSystemTime(new Date("2026-11-03T15:00:02Z"));
    expect((await GET(request("  av.  larco   345 "))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-03T15:05:03Z"));
    expect((await GET(request("Av. Larco 345"))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un fallo del proveedor no se guarda en caché", async () => {
    const { GET } = await import("@/app/api/lugares/buscar/route");
    const request = () => new NextRequest("http://localhost:3000/api/lugares/buscar?q=larco%20345");
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect((await GET(request())).status).toBe(502);
    vi.setSystemTime(new Date("2026-11-03T15:00:02Z"));
    fetchMock.mockResolvedValueOnce(jsonResponse(photon));
    expect((await GET(request())).status).toBe(200);
  });
});
