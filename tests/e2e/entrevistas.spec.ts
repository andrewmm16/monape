import { expect, test, type Page } from "@playwright/test";
import { makePdf } from "../fixtures/documents";

/**
 * Entrevistas, contra un proyecto Supabase de PRUEBAS. Crea una vacante con dos
 * requisitos y tres candidatos ficticios (los tres se evalúan al registrarse):
 * uno que pasa, uno que no pasa y uno que no asiste.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

/** Solo letras: la sugerencia de nombre descarta líneas con cifras. */
function lettersOnly(): string {
  const raw = Date.now().toString(26).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Fecha de Lima (aaaa-mm-dd) a `days` días de hoy. */
function limaDate(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  );
}

async function scheduleFromDialog(
  page: Page,
  values: { date: string; time: string; location?: string; interviewers?: string },
) {
  const dialog = page.getByRole("dialog", { name: "Programar entrevista" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Fecha").fill(values.date);
  await dialog.getByLabel("Hora").fill(values.time);
  await dialog.getByLabel("Modalidad").selectOption({ label: "Virtual" });
  if (values.location) await dialog.getByLabel("Lugar o enlace").fill(values.location);
  if (values.interviewers) await dialog.getByLabel("Entrevistadores").fill(values.interviewers);
  await dialog.getByRole("button", { name: "Programar", exact: true }).click();
  await expect(page.getByText(/Entrevista programada\. La postulación quedó/)).toBeVisible();
}

test("RRHH agenda entrevistas, registra Pasó / No pasó / No asistió y los descartados salen del proceso", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const tag = lettersOnly();
  const title = `Analista Entrevistas ${tag}`;
  const names = { pass: `Paula ${tag} Pasa`, fail: `Nora ${tag} Falla`, absent: `Aldo ${tag} Ausente` };
  const meetingLink = "https://meet.ejemplo.test/sala-ficticia";

  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(rrhh.email!);
  await page.getByLabel("Contraseña").fill(rrhh.password!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);

  // La navegación incluye «Entrevistas».
  await expect(page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Entrevistas" })).toBeVisible();

  // Vacante con dos requisitos y criterios aprobados.
  await page.goto("/vacantes/nueva");
  await page.getByLabel("Título del puesto").fill(title);
  await page.getByLabel("Área o departamento").fill("Pruebas");
  await page.getByLabel("Descripción", { exact: true }).fill(
    "Descripción ficticia de la vacante de pruebas: análisis de información y elaboración de reportes.",
  );
  await page.getByLabel("Ciudad", { exact: true }).fill("Lima");
  await page.getByLabel("Región", { exact: true }).fill("Lima");
  await page.getByLabel("Tipo de empleo").selectOption({ label: "Tiempo completo" });
  await page.getByRole("button", { name: "Crear vacante" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const vacancyUrl = page.url().split("?")[0]!;

  await page.goto(`${vacancyUrl}?tab=criterios`);
  for (const [requirement, terms] of [
    ["Consultas SQL", "SQL, SQL Server"],
    ["Inglés intermedio", "Inglés"],
  ] as const) {
    await page.getByRole("button", { name: "Agregar requisito" }).click();
    const dialog = page.getByRole("dialog", { name: "Nuevo requisito" });
    await dialog.getByRole("textbox", { name: "Requisito", exact: true }).fill(requirement);
    await dialog.getByLabel("Términos de búsqueda").fill(terms);
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(requirement, { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Aprobar criterios" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar criterios" }).click();
  await expect(page.getByText(/Versión 1 aprobada/)).toBeVisible();

  // Tres candidatos por carga masiva (CV con SQL, sin inglés).
  await page.goto(`${vacancyUrl}/carga-masiva`);
  await page.getByLabel("Portal de origen de los CV").selectOption({ label: "Computrabajo" });
  await page.getByRole("button", { name: "Iniciar lote" }).click();
  await expect(page.getByText("Portal de origen:")).toBeVisible();
  const cv = (name: string) => [
    name,
    "Analista de datos",
    `${name.split(" ")[0]!.toLowerCase()}.${tag.toLowerCase()}@correo.test`,
    "Experiencia con SQL Server y reportes mensuales para las áreas usuarias.",
    "Formación en ingeniería industrial y manejo de herramientas de análisis de información.",
  ];
  const files = {
    pass: await makePdf(cv(names.pass)),
    fail: await makePdf(cv(names.fail)),
    absent: await makePdf(cv(names.absent)),
  };
  await page.locator('input[type="file"]').setInputFiles(
    (Object.keys(files) as (keyof typeof files)[]).map((key) => ({
      name: `${key}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(files[key]),
    })),
  );
  await expect(page.getByTestId("batch-item")).toHaveCount(3);
  await page.getByRole("button", { name: "Registrar seleccionados (3)" }).click();
  await expect(page.getByText(/Registrados: 3 · Evaluados por reglas: 3/)).toBeVisible();

  const applicationIdOf = async (name: string) => {
    await page.goto(`${vacancyUrl}?tab=candidatos`);
    const href = await page.getByRole("link", { name, exact: true }).getAttribute("href");
    return href!.split("/").pop()!;
  };
  const ids = { pass: await applicationIdOf(names.pass), fail: await applicationIdOf(names.fail), absent: await applicationIdOf(names.absent) };

  // --- 1. Programar desde una postulación evaluada: pasa a «Entrevista programada» y aparece en /entrevistas.
  await page.goto(`/postulaciones/${ids.pass}`);
  await expect(page.locator("#entrevistas").getByText("Entrevistas", { exact: true })).toBeVisible();
  await expect(page.getByText("Sin entrevistas")).toBeVisible();
  await page.getByRole("button", { name: "Programar entrevista" }).click();
  await scheduleFromDialog(page, {
    date: limaDate(1),
    time: "10:00",
    location: meetingLink,
    interviewers: "Ana Gómez, Pedro Ruiz",
  });
  const interviewsCard = page.locator("#entrevistas");
  await expect(interviewsCard.getByTestId("interview-item")).toHaveCount(1);
  await expect(interviewsCard.getByText("Programada", { exact: true })).toBeVisible();
  await expect(interviewsCard.getByText("Ana Gómez, Pedro Ruiz")).toBeVisible();
  // El enlace de la reunión es un enlace seguro.
  const link = interviewsCard.getByRole("link", { name: meetingLink });
  await expect(link).toHaveAttribute("href", meetingLink);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByText("Entrevista programada", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Cambio de estado: .+ → Entrevista programada/).first()).toBeVisible();
  await expect(page.getByText(/Motivo: Entrevista programada para el \d{2}\/\d{2}\/\d{4} 10:00/)).toBeVisible();

  await page.goto(`/entrevistas`);
  await expect(page.getByRole("heading", { name: /^Próximas/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mañana" })).toBeVisible();
  const passItem = page.getByTestId("interview-item").filter({ hasText: names.pass });
  await expect(passItem).toContainText(title);
  await expect(passItem).toContainText("45 min");
  await expect(passItem).toContainText("Virtual");
  await expect(passItem.getByRole("link", { name: meetingLink })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(passItem.getByRole("link", { name: names.pass })).toHaveAttribute("href", `/postulaciones/${ids.pass}`);

  // Filtro por vacante: otra vacante no muestra esta entrevista.
  await page.getByLabel("Vacante").selectOption({ label: title });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/vacante=/);
  await expect(page.getByTestId("interview-item").filter({ hasText: names.pass })).toHaveCount(1);

  // --- 2. Registrar «Pasó» y marcar un requisito «Cumple».
  await passItem.getByRole("button", { name: "Registrar resultado" }).click();
  const resultDialog = page.getByRole("dialog", { name: "Registrar resultado" });
  await resultDialog.getByRole("button", { name: "Registrar resultado" }).click();
  await expect(resultDialog.getByText("Seleccione el resultado de la entrevista")).toBeVisible();
  await resultDialog.getByLabel("Pasó", { exact: true }).check();
  await expect(resultDialog.getByTestId("interview-consequence")).toContainText("pasará a «En evaluación»");
  await expect(resultDialog.getByText("Requisitos comprobados en la entrevista")).toBeVisible();
  const english = resultDialog.getByLabel("Resultado de «Inglés intermedio»");
  await expect(english).toBeVisible();
  await expect(resultDialog.getByText(/Inglés intermedio/).first()).toBeVisible();
  await expect(resultDialog.getByText("Valoración actual: Sin evidencia suficiente")).toBeVisible();
  await english.selectOption({ label: "Cumple" });
  await resultDialog.getByRole("button", { name: "Registrar resultado" }).click();
  await expect(page.getByText(/Resultado registrado\. La postulación está en «En evaluación»/)).toBeVisible();

  await page.goto(`/postulaciones/${ids.pass}`);
  await expect(page.getByText("En evaluación", { exact: true }).first()).toBeVisible();
  const englishItem = page.getByRole("listitem").filter({ hasText: "Inglés intermedio" }).filter({ hasText: "Peso" });
  await expect(englishItem).toContainText("Verificado · Entrevista");
  await expect(englishItem).toContainText(/Comprobado en la entrevista del \d{2}\/\d{2}\/\d{4}/);
  await expect(page.locator("#entrevistas").getByText("Pasó", { exact: true })).toBeVisible();
  await expect(page.locator("#entrevistas").getByRole("button", { name: "Registrar resultado" })).toHaveCount(0);
  await expect(page.getByText("Resultado de la entrevista").first()).toBeVisible();

  // --- 3. «No pasó» con motivo: pasa a «No seleccionado», sale de «En proceso» y no es comparable.
  await page.goto(`/postulaciones/${ids.fail}?programar=1`);
  const warningDialog = page.getByRole("dialog", { name: "Programar entrevista" });
  await warningDialog.getByLabel("Fecha").fill(limaDate(-1));
  await expect(warningDialog.getByText(/La fecha ya pasó/)).toBeVisible();
  await warningDialog.getByLabel("Hora").fill("16:30");
  await warningDialog.getByLabel("Modalidad").selectOption({ label: "Presencial" });
  await warningDialog.getByLabel("Lugar o enlace").fill("Av. Larco 345, oficina 2");
  await warningDialog.getByRole("button", { name: "Programar", exact: true }).click();
  await expect(page.getByText(/Entrevista programada\. La postulación quedó/)).toBeVisible();
  // Un lugar que no es enlace se muestra como texto plano.
  await expect(page.locator("#entrevistas").getByText("Av. Larco 345, oficina 2")).toBeVisible();
  await expect(page.locator("#entrevistas").getByRole("link", { name: "Av. Larco 345, oficina 2" })).toHaveCount(0);

  await page.goto("/entrevistas");
  await expect(page.getByRole("heading", { name: /^Pendientes de resultado/ })).toBeVisible();
  const failItem = page.getByTestId("interview-item").filter({ hasText: names.fail });
  await failItem.getByRole("button", { name: "Registrar resultado" }).click();
  const failDialog = page.getByRole("dialog", { name: "Registrar resultado" });
  await failDialog.getByLabel("No pasó", { exact: true }).check();
  await expect(failDialog.getByTestId("interview-consequence")).toContainText("No seleccionado");
  await expect(failDialog.getByTestId("interview-consequence")).toContainText("Descartados");
  await failDialog.getByRole("button", { name: "Registrar resultado" }).click();
  await expect(failDialog.getByText("Indique el motivo (al menos 3 caracteres)")).toBeVisible();
  await failDialog.getByLabel("Motivo (obligatorio)").fill("No cumple la experiencia requerida");
  await failDialog.getByRole("button", { name: "Registrar resultado" }).click();
  await expect(page.getByText(/Resultado registrado\. La postulación está en «No seleccionado» y se movió a Descartados/)).toBeVisible();

  await page.goto(`/postulaciones/${ids.fail}`);
  await expect(page.getByText("No seleccionado", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Motivo: No pasó la entrevista del \d{2}\/\d{2}\/\d{4}: No cumple la experiencia requerida/)).toBeVisible();
  await expect(page.locator("#entrevistas").getByText("No pasó", { exact: true })).toBeVisible();
  // No se borró nada: el historial y la evaluación siguen ahí.
  await expect(page.getByText("Detalle por requisito")).toBeVisible();

  await page.goto(`${vacancyUrl}?tab=candidatos`);
  await expect(page.getByRole("link", { name: /^En proceso \(2\)$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Descartados \(1\)$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: names.fail, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: names.pass, exact: true })).toBeVisible();
  // El selector de estado de «En proceso» no ofrece los descartados.
  const statusSelect = page.getByLabel("Estado del proceso");
  await expect(statusSelect.locator("option", { hasText: "No seleccionado" })).toHaveCount(0);
  await expect(statusSelect.locator("option", { hasText: "Retirado" })).toHaveCount(0);

  await page.getByRole("link", { name: /^Descartados \(1\)$/ }).click();
  await expect(page).toHaveURL(/vista=descartados/);
  await expect(page.getByRole("link", { name: names.fail, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: names.pass, exact: true })).toHaveCount(0);
  await expect(page.getByLabel(`Comparar a ${names.fail}`)).toHaveCount(0);
  await expect(page.getByLabel("Estado del proceso").locator("option", { hasText: /^No seleccionado$/ })).toHaveCount(1);
  await expect(page.getByLabel("Estado del proceso").locator("option", { hasText: "Nuevo" })).toHaveCount(0);

  // Comparar a un descartado no es posible.
  await page.goto(`${vacancyUrl}/comparar?ids=${ids.fail},${ids.pass}`);
  await expect(page.getByText("No se puede mostrar la comparación")).toBeVisible();
  await expect(page.getByText(/ya fue descartada/)).toBeVisible();

  // --- 4. «No asistió»: la postulación conserva su estado. Reprogramar y cancelar.
  await page.goto(`/postulaciones/${ids.absent}?programar=1`);
  await page.getByRole("dialog", { name: "Programar entrevista" }).getByLabel("Fecha").fill(limaDate(-2));
  await page.getByRole("dialog", { name: "Programar entrevista" }).getByLabel("Hora").fill("09:00");
  await page.getByRole("dialog", { name: "Programar entrevista" }).getByRole("button", { name: "Programar", exact: true }).click();
  await expect(page.getByText(/Entrevista programada\. La postulación quedó/)).toBeVisible();

  await page.goto("/entrevistas");
  const absentItem = page.getByTestId("interview-item").filter({ hasText: names.absent });
  await absentItem.getByRole("button", { name: "Registrar resultado" }).click();
  const absentDialog = page.getByRole("dialog", { name: "Registrar resultado" });
  await absentDialog.getByLabel("No asistió", { exact: true }).check();
  await expect(absentDialog.getByTestId("interview-consequence")).toContainText("mantiene su estado");
  // Si no asistió no hay requisitos que comprobar.
  await expect(absentDialog.getByText("Requisitos comprobados en la entrevista")).toHaveCount(0);
  await absentDialog.getByRole("button", { name: "Registrar resultado" }).click();
  await expect(page.getByText(/Resultado registrado\. La postulación está en «Entrevista programada»/)).toBeVisible();

  await expect(page.getByRole("heading", { name: /^Realizadas recientemente/ })).toBeVisible();
  const recentAbsent = page.getByTestId("interview-item").filter({ hasText: names.absent });
  await expect(recentAbsent).toContainText("No asistió");
  await expect(recentAbsent.getByRole("button", { name: "Registrar resultado" })).toHaveCount(0);
  // En las realizadas se ven los distintivos Pasó y No pasó.
  await expect(page.getByTestId("interview-item").filter({ hasText: names.pass })).toContainText("Pasó");
  await expect(page.getByTestId("interview-item").filter({ hasText: names.fail })).toContainText("No pasó");

  // Una segunda entrevista del mismo candidato: se reprograma y luego se cancela.
  await page.goto(`/postulaciones/${ids.absent}`);
  await page.getByRole("button", { name: "Programar entrevista" }).click();
  await scheduleFromDialog(page, { date: limaDate(2), time: "11:00", location: "Sala 3", interviewers: "Rosa Díaz" });
  const second = page.locator("#entrevistas").getByTestId("interview-item").filter({ hasText: "Rosa Díaz" });
  await second.getByRole("button", { name: "Reprogramar" }).click();
  const rescheduleDialog = page.getByRole("dialog", { name: "Reprogramar entrevista" });
  await expect(rescheduleDialog.getByLabel("Hora")).toHaveValue("11:00");
  await rescheduleDialog.getByLabel("Hora").fill("15:30");
  await rescheduleDialog.getByLabel("Duración (minutos)").fill("60");
  await rescheduleDialog.getByRole("button", { name: "Reprogramar", exact: true }).click();
  await expect(page.getByText("Entrevista reprogramada.")).toBeVisible();
  await expect(second).toContainText("15:30");
  await expect(second).toContainText("1 h");

  // El panel muestra las próximas entrevistas (dentro de 7 días).
  await page.goto("/panel");
  const upcoming = page.getByText("Próximas entrevistas", { exact: true });
  await expect(upcoming).toBeVisible();
  await expect(page.getByRole("link", { name: names.absent }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver todas las entrevistas" })).toHaveAttribute("href", "/entrevistas");

  await page.goto(`/postulaciones/${ids.absent}`);
  await page.locator("#entrevistas").getByTestId("interview-item").filter({ hasText: "Rosa Díaz" }).getByRole("button", { name: "Cancelar" }).click();
  const cancelDialog = page.getByRole("dialog", { name: "Cancelar entrevista" });
  await expect(cancelDialog).toContainText("mantiene su estado actual");
  await cancelDialog.getByRole("button", { name: "Cancelar entrevista" }).click();
  await expect(cancelDialog.getByText(/Escriba el motivo/)).toBeVisible();
  await cancelDialog.getByLabel("Motivo").fill("El candidato pidió otra fecha");
  await cancelDialog.getByRole("button", { name: "Cancelar entrevista" }).click();
  await expect(page.getByText("Entrevista cancelada. La postulación mantiene su estado.")).toBeVisible();
  await expect(page.locator("#entrevistas").getByText("Cancelada", { exact: true })).toBeVisible();
  await expect(page.locator("#entrevistas").getByText("Motivo de la cancelación:")).toBeVisible();
  // La cancelación no cambió el estado de la postulación.
  await expect(page.getByText("Entrevista programada", { exact: true }).first()).toBeVisible();

  // --- Comparación: la fila «Entrevista» y el enlace para programar.
  await page.goto(`${vacancyUrl}/comparar?ids=${ids.pass},${ids.absent}`);
  const table = page.getByTestId("comparison-scroll");
  const interviewRow = table.locator("tr", { has: page.getByRole("rowheader", { name: "Entrevista", exact: true }) });
  await expect(interviewRow).toContainText("Pasó");
  await expect(interviewRow).toContainText("Sin entrevista");
  await expect(table.getByRole("link", { name: "Programar entrevista" })).toHaveCount(2);
  await expect(table.getByRole("link", { name: "Programar entrevista" }).first()).toHaveAttribute("href", /\/postulaciones\/.+\?programar=1/);
  // Quien pasó la entrevista queda primero entre dos candidatos con la misma puntuación.
  const texts = await page.getByTestId("compare-column").allInnerTexts();
  expect(texts[0]).toContain(names.pass);
});

test("Entrevistas: la lista se ve completa en un ancho de celular", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "movil", "Solo en el proyecto móvil.");
  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(rrhh.email!);
  await page.getByLabel("Contraseña").fill(rrhh.password!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);
  await page.goto("/entrevistas");
  await expect(page.getByRole("heading", { name: "Entrevistas", exact: true })).toBeVisible();
  // Ninguna fila se sale de la pantalla.
  const overflowing = await page.getByTestId("interview-item").evaluateAll((items) =>
    items.filter((item) => item.getBoundingClientRect().right > window.innerWidth + 1).length,
  );
  expect(overflowing).toBe(0);
});
