import type { Locator, Page } from "@playwright/test";

/**
 * Resolución LOCAL y gratuita de desafíos de verificación, solo con lógica de
 * programación y el motor de Playwright (sin OCR, sin servicios externos ni de pago,
 * SIN intervención humana). Es de uso interno del bot contra los portales FICTICIOS
 * propios: como controlamos el DOM, la respuesta de cada desafío es derivable de él.
 *
 * Despacha según el tipo presente en la pantalla, imitando la mecánica de los captchas
 * reales de los portales de empleo:
 *   - casilla   «No soy un robot»: hover + espera + clic (reCAPTCHA v2).
 *   - imagenes  cuadrícula: clica las celdas marcadas `data-correcta="true"` (reCAPTCHA de imágenes).
 *   - rotar     gira la imagen hasta el ángulo objetivo leído del DOM (Arkose/LinkedIn).
 *   - slider    arrastra el tirador hasta el objetivo con trayectoria realista (DataDome/GeeTest).
 *   - otp       lee el código de un buzón falso y lo escribe (verificación por correo).
 *   - texto/suma  lee el enunciado y escribe la respuesta (texto distorsionado / aritmética).
 */

/** Acceso a los elementos del desafío por clave del libro de selectores; `null` si no está. */
export interface DesafioHelpers {
  probe(clave: string, options?: { all?: boolean }): Promise<Locator | null>;
  /** Lee el código OTP del buzón falso del portal (lo inyecta el adaptador); `null` si no hay. */
  obtenerCodigoOtp?(): Promise<string | null>;
  log?(mensaje: string): void;
}

/** Punto en coordenadas de página (CSS px). */
export interface Punto {
  x: number;
  y: number;
}

/**
 * Resuelve una operación aritmética simple incrustada en texto. Acepta `+ - × * /` y
 * las palabras `mas/más/menos/por`. Devuelve `null` si no reconoce una operación con
 * dos enteros (p. ej. texto libre), para que el llamador use otra vía.
 */
export function resolverAritmetica(texto: string): number | null {
  const limpio = texto.toLowerCase().replace(/,/g, "");
  const m = /(-?\d+)\s*(\+|-|x|×|\*|\/|por|mas|más|menos)\s*(-?\d+)/.exec(limpio);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  switch (m[2]) {
    case "+":
    case "mas":
    case "más":
      return a + b;
    case "-":
    case "menos":
      return a - b;
    case "x":
    case "×":
    case "*":
    case "por":
      return a * b;
    case "/":
      return b !== 0 ? a / b : null;
    default:
      return null;
  }
}

/**
 * Para un desafío de texto plano: devuelve la palabra entre comillas («…», "…", '…')
 * o, si no hay, la primera palabra en MAYÚSCULAS (≥ 3 letras) del enunciado. `null`
 * si no encuentra ninguna.
 */
export function respuestaTextoEstatico(texto: string): string | null {
  const entreComillas = /[«"']([^«»"']{1,40})[»"']/.exec(texto);
  if (entreComillas) return entreComillas[1]!.trim();
  const enMayusculas = /\b([A-ZÁÉÍÓÚÑÜ]{3,})\b/.exec(texto);
  return enMayusculas ? enMayusculas[1]! : null;
}

/**
 * Cuántas veces hay que pulsar «girar 90°» para llevar la imagen de `actual` a
 * `objetivo` (ambos en grados, se redondean al múltiplo de 90 más cercano). Función
 * pura para poder probar la lógica de rotación.
 */
export function clicsParaRotar(actual: number, objetivo: number): number {
  const cuartos = (grados: number) => (((Math.round(grados / 90) % 4) + 4) % 4);
  return ((cuartos(objetivo) - cuartos(actual)) % 4 + 4) % 4;
}

/**
 * Puntos intermedios de un arrastre, de `desde` a `hasta`, en `pasos` tramos iguales.
 * Función pura (sin Playwright) para poder probar la trayectoria del deslizador.
 */
export function pasosArrastre(desde: Punto, hasta: Punto, pasos = 20): Punto[] {
  const total = Math.max(1, Math.floor(pasos));
  const salida: Punto[] = [];
  for (let i = 1; i <= total; i++) {
    const t = i / total;
    salida.push({ x: desde.x + (hasta.x - desde.x) * t, y: desde.y + (hasta.y - desde.y) * t });
  }
  return salida;
}

/**
 * Arrastre con trayectoria de apariencia humana: aceleración (easing), pequeño temblor
 * vertical (jitter), sobrepaso (overshoot) y corrección final hacia el objetivo, con
 * una pausa antes de soltar. Termina exactamente en `hasta`. Usa eventos reales de
 * `page.mouse` (`isTrusted`), que es lo que un portal serio valida.
 */
async function arrastrarRealista(page: Page, desde: Punto, hasta: Punto): Promise<void> {
  const pasos = 22 + Math.floor(Math.random() * 14);
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const overshoot = 3 + Math.random() * 4;
  const dx = hasta.x - desde.x;

  await page.mouse.move(desde.x, desde.y);
  await page.mouse.down();
  for (let i = 1; i <= pasos; i++) {
    const t = i / pasos;
    const x = desde.x + (dx + overshoot) * ease(t);
    const y = desde.y + (Math.random() - 0.5) * 2;
    await page.mouse.move(x, y);
    await page.waitForTimeout(6 + Math.random() * 12);
  }
  for (let k = 0; k < 3; k++) {
    await page.mouse.move(hasta.x + overshoot * (1 - (k + 1) / 3), desde.y);
    await page.waitForTimeout(20);
  }
  await page.mouse.move(hasta.x, desde.y);
  await page.waitForTimeout(60 + Math.random() * 90);
  await page.mouse.up();
}

/** Lee el enunciado, lo resuelve (aritmética o texto) y escribe la respuesta. */
async function resolverPregunta(helpers: DesafioHelpers): Promise<boolean> {
  const pregunta = await helpers.probe("desafio_pregunta");
  const respuesta = await helpers.probe("desafio_respuesta");
  if (!pregunta || !respuesta) return false;
  const texto = (await pregunta.innerText()).trim();
  const calculo = resolverAritmetica(texto);
  const valor = calculo !== null ? String(calculo) : respuestaTextoEstatico(texto);
  if (valor === null) {
    helpers.log?.(`Desafío de texto no reconocido: «${texto.slice(0, 60)}»`);
    return false;
  }
  await respuesta.fill(valor);
  return true;
}

/** Marca la casilla «no soy un robot» con un comportamiento mínimamente humano (hover + espera). */
async function resolverCasilla(page: Page, helpers: DesafioHelpers): Promise<boolean> {
  const casilla = await helpers.probe("desafio_casilla");
  if (!casilla) return false;
  await casilla.hover().catch(() => undefined);
  await page.waitForTimeout(400 + Math.random() * 500);
  await casilla.click();
  return true;
}

/** Clica las celdas de la cuadrícula marcadas como correctas en el DOM (`data-correcta="true"`). */
async function resolverImagenes(helpers: DesafioHelpers): Promise<boolean> {
  const celdas = await helpers.probe("desafio_celda", { all: true });
  if (!celdas) return false;
  const total = await celdas.count();
  let clicadas = 0;
  for (let i = 0; i < total; i++) {
    const celda = celdas.nth(i);
    if ((await celda.getAttribute("data-correcta")) === "true") {
      await celda.click();
      clicadas++;
    }
  }
  return clicadas > 0;
}

/** Pulsa «girar» las veces necesarias para llevar la imagen del ángulo actual al objetivo (ambos en el DOM). */
async function resolverRotar(helpers: DesafioHelpers): Promise<boolean> {
  const img = await helpers.probe("desafio_rotar");
  const girar = await helpers.probe("desafio_girar");
  if (!img || !girar) return false;
  const actual = Number(await img.getAttribute("data-angulo"));
  const objetivo = Number(await img.getAttribute("data-objetivo"));
  if (!Number.isFinite(actual) || !Number.isFinite(objetivo)) return false;
  const veces = clicsParaRotar(actual, objetivo);
  for (let k = 0; k < veces; k++) await girar.click();
  return true;
}

/** Arrastra el tirador hasta el objetivo (`data-objetivo` del riel) con trayectoria realista. */
async function resolverSlider(page: Page, helpers: DesafioHelpers): Promise<boolean> {
  const tirador = await helpers.probe("desafio_slider");
  const pista = await helpers.probe("desafio_pista");
  if (!tirador || !pista) return false;
  const cajaTirador = await tirador.boundingBox();
  const cajaPista = await pista.boundingBox();
  if (!cajaTirador || !cajaPista) return false;
  const objetivo = Number(await pista.getAttribute("data-objetivo"));
  const inicio: Punto = { x: cajaTirador.x + cajaTirador.width / 2, y: cajaTirador.y + cajaTirador.height / 2 };
  // Puntero que deja el borde izquierdo del tirador en `objetivo` px del riel.
  const destinoX = Number.isFinite(objetivo)
    ? cajaPista.x + objetivo + cajaTirador.width / 2
    : cajaPista.x + cajaPista.width - cajaTirador.width / 2;
  await arrastrarRealista(page, inicio, { x: destinoX, y: inicio.y });
  return true;
}

/** Lee el código OTP del buzón falso y lo escribe. */
async function resolverOtp(helpers: DesafioHelpers): Promise<boolean> {
  const codigo = (await helpers.obtenerCodigoOtp?.()) ?? null;
  if (!codigo) return false;
  const respuesta = await helpers.probe("desafio_respuesta");
  if (!respuesta) return false;
  await respuesta.fill(codigo);
  return true;
}

/**
 * Intenta resolver el desafío presente en la página con lógica interna, despachando
 * según el tipo. Si lo resuelve, pulsa el botón de enviar (si existe) y espera la
 * recarga. Devuelve `true` si llegó a aplicar una solución; el llamador debe
 * reconfirmar leyendo de nuevo la página.
 */
export async function resolverDesafioLocal(page: Page, helpers: DesafioHelpers): Promise<boolean> {
  let resuelto: boolean;
  if ((await helpers.probe("desafio_casilla")) !== null) resuelto = await resolverCasilla(page, helpers);
  else if ((await helpers.probe("desafio_celda")) !== null) resuelto = await resolverImagenes(helpers);
  else if ((await helpers.probe("desafio_girar")) !== null) resuelto = await resolverRotar(helpers);
  else if ((await helpers.probe("desafio_slider")) !== null) resuelto = await resolverSlider(page, helpers);
  else if ((await helpers.probe("desafio_otp")) !== null) resuelto = await resolverOtp(helpers);
  else resuelto = await resolverPregunta(helpers);
  if (!resuelto) return false;

  const enviar = await helpers.probe("desafio_enviar");
  if (enviar) {
    await enviar.click().catch(() => undefined);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }
  return true;
}
