/** Los cinco portales ficticios de la demostración (ninguno es un portal real). */
export const PORTAL_SLUGS = ["linkedin", "bumeran", "trabajos-diarios", "indeed", "computrabajo"] as const;
export type PortalSlug = (typeof PORTAL_SLUGS)[number];

export interface FakeApplicant {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  /** Contenido del CV (bytes de un PDF). */
  resume: Uint8Array;
}

export interface FakeJob {
  id: string;
  /** Portal ficticio donde se publicó. */
  portal: PortalSlug;
  title: string;
  description: string;
  status: "activa" | "retirada";
  /** Cuándo la publicó el robot (ISO). */
  createdAt: string;
  applicants: FakeApplicant[];
  company?: string;
  location?: string;
  /** Preguntas de selección (solo las que el portal pide al candidato). */
  questions?: string[];
}

/** Tipos de desafío simulados, inspirados en los captchas reales de los portales de empleo. */
export type DesafioTipo = "suma" | "texto" | "slider" | "casilla" | "imagenes" | "rotar" | "otp";

/** Palabra por defecto del desafío de texto (la lee y la escribe el robot). Fuente única para render y verificación. */
export const PALABRA_DESAFIO = "AZUL";
/** Posición objetivo y tolerancia por defecto del slider (px). Deben coincidir en render y verificación. */
export const SLIDER_OBJETIVO = 240;
export const SLIDER_TOLERANCIA = 6;

/**
 * Desafío de verificación simulado que el robot resuelve con lógica interna (sin
 * intervención humana, sin servicios externos). Cada tipo imita la MECÁNICA de un
 * captcha real, pero su solución es derivable del DOM que nosotros controlamos:
 *  - `suma`      aritmética a leer y escribir (captcha matemático).
 *  - `texto`     palabra a leer y escribir (texto distorsionado).
 *  - `slider`    arrastrar la pieza hasta el objetivo ±tolerancia (DataDome/GeeTest).
 *  - `casilla`   «No soy un robot» con tiempo mínimo en pantalla (reCAPTCHA v2).
 *  - `imagenes`  seleccionar las celdas correctas de una cuadrícula (reCAPTCHA de imágenes).
 *  - `rotar`     girar la imagen hasta el ángulo objetivo (Arkose/LinkedIn).
 *  - `otp`       código «enviado al correo», que el bot lee de un buzón falso.
 */
export interface Desafio {
  tipo: DesafioTipo;
  /** Operandos de la suma (solo `tipo: "suma"`). */
  a: number;
  b: number;
  /** `texto`: palabra que hay que escribir. */
  palabra?: string;
  /** `slider`: posición objetivo del tirador (px desde el inicio del riel) y tolerancia ±. */
  objetivo?: number;
  tolerancia?: number;
  /** `imagenes`: categoría de la consigna y celdas de la cuadrícula (`true` = correcta). */
  categoria?: string;
  celdas?: boolean[];
  /** `rotar`: ángulo inicial y ángulo objetivo (grados, múltiplos de 90). */
  angulo?: number;
  anguloObjetivo?: number;
  /** `otp`: código de 6 dígitos «enviado al correo». */
  codigo?: string;
}

/** Índices (ordenados) de las celdas correctas de un desafío de imágenes. */
export function celdasCorrectas(desafio: Desafio): number[] {
  return (desafio.celdas ?? []).flatMap((correcta, indice) => (correcta ? [indice] : []));
}

/**
 * Comprueba la respuesta de un desafío a partir de los campos del formulario. Lógica
 * pura (sin red ni DOM) para poder probarla. Incluye el honeypot: si el campo trampa
 * trae algo, la verificación falla (un humano no lo rellena; un bot ingenuo sí).
 */
export function verificarDesafio(desafio: Desafio, fields: Record<string, string>): boolean {
  if ((fields.trampa ?? "").trim() !== "") return false;
  const respuesta = (fields.respuesta ?? "").trim();
  const numero = Number(respuesta);
  switch (desafio.tipo) {
    case "suma":
      return respuesta !== "" && numero === desafio.a + desafio.b;
    case "texto":
      return respuesta !== "" && respuesta.toUpperCase() === (desafio.palabra ?? PALABRA_DESAFIO).toUpperCase();
    case "slider": {
      const objetivo = desafio.objetivo ?? SLIDER_OBJETIVO;
      const tolerancia = desafio.tolerancia ?? SLIDER_TOLERANCIA;
      return respuesta !== "" && Number.isFinite(numero) && Math.abs(numero - objetivo) <= tolerancia;
    }
    case "casilla":
      return respuesta === "ok" && Number(fields.tiempo ?? "0") >= 250;
    case "imagenes": {
      const elegidas = respuesta
        .split(",")
        .map((valor) => valor.trim())
        .filter((valor) => valor !== "")
        .map(Number)
        .filter(Number.isInteger)
        .sort((x, y) => x - y);
      const correctas = celdasCorrectas(desafio);
      return elegidas.length === correctas.length && elegidas.every((valor, i) => valor === correctas[i]);
    }
    case "rotar": {
      const objetivo = (((desafio.anguloObjetivo ?? 0) % 360) + 360) % 360;
      const actual = ((((Number.isFinite(numero) ? numero : NaN) % 360) + 360) % 360);
      return respuesta !== "" && Number.isFinite(numero) && actual === objetivo;
    }
    case "otp":
      return respuesta !== "" && respuesta === desafio.codigo;
  }
}

/** Fallas simuladas de un portal. */
export interface PortalFlags {
  loggedIn: boolean;
  changed: boolean;
  rejecting: boolean;
  /** Desafío de verificación activo, o `null` si no hay. */
  desafio: Desafio | null;
}
