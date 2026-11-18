import { expect, test, type Page } from "@playwright/test";
import { makePdf } from "../fixtures/documents";

/**
 * Evaluación por entrevista y base de talentos, contra un proyecto Supabase de
 * PRUEBAS (`npm run db:seed`). Un candidato pasa por una entrevista que no supera,
 * el equipo lo evalúa, RRHH lo etiqueta como finalista y, cuando se abre una
 * vacante parecida, aparece entre los sugeridos y se reactiva en lote. Al final
 * un administrador revisa la auditoría de la base de talentos.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");
test.describe.configure({ mode: "serial" });

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

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);
}

/** Crea una vacante con un requisito; aprueba los criterios si se pide. Devuelve su URL. */
async function createVacancy(page: Page, title: string, requirement: string, approve: boolean): Promise<string> {
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
  const url = page.url().split("?")[0]!;

  await page.goto(`${url}?tab=criterios`);
  await page.getByRole("button", { name: "Agregar requisito" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo requisito" });
  await dialog.getByRole("textbox", { name: "Requisito", exact: true }).fill(requirement);
  await dialog.getByLabel("Términos de búsqueda").fill(requirement);
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(requirement, { exact: true })).toBeVisible();
  if (approve) {
    await page.getByRole("button", { name: "Aprobar criterios" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar criterios" }).click();
    await expect(page.getByText(/Versión 1 aprobada/)).toBeVisible();
  }
  return url;
}

// Datos compartidos entre las pruebas del archivo (se ejecutan en orden).
const tag = lettersOnly();
// Término inventado: solo el candidato de esta prueba lo tiene en su CV.
const skill = `Kestrel ${tag}`;
const candidateName = `Ines ${tag} Base`;
const tagName = `Finalista ${tag}`;
const origin = `Origen Talento ${tag}`;
const target = `Destino Talento ${tag}`;

test("una entrevista realizada se evalúa en equipo; el candidato cerrado se etiqueta y se reactiva desde la base", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  await signIn(page, rrhh.email!, rrhh.password!);

  // --- 1. Vacante de origen y un candidato por carga masiva con el término en el CV.
  const originUrl = await createVacancy(page, origin, skill, true);
  await page.goto(`${originUrl}/carga-masiva`);
  await page.getByLabel("Portal de origen de los CV").selectOption({ label: "Computrabajo" });
  await page.getByRole("button", { name: "Iniciar lote" }).click();
  await expect(page.getByText("Portal de origen:")).toBeVisible();
  const pdf = await makePdf([
    candidateName,
    "Analista de datos",
    `ines.${tag.toLowerCase()}@correo.test`,
    `Experiencia con ${skill} en proyectos de reportes para las áreas usuarias.`,
    "Formación en ingeniería industrial y manejo de herramientas de análisis de información.",
  ]);
  await page.locator('input[type="file"]').setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
  // La lectura de los CV puede tardar con el equipo cargado.
  await expect(page.getByTestId("batch-item")).toHaveCount(1, { timeout: 30_000 });
  await page.getByRole("button", { name: "Registrar seleccionados (1)" }).click();
  await expect(page.getByText(/Registrados: 1/)).toBeVisible();

  await page.goto(`${originUrl}?tab=candidatos`);
  const href = await page.getByRole("link", { name: candidateName, exact: true }).getAttribute("href");
  const applicationId = href!.split("/").pop()!;

  // --- 2. Entrevista programada: la evaluación del equipo aún no se habilita.
  await page.goto(`/postulaciones/${applicationId}?programar=1`);
  const schedule = page.getByRole("dialog", { name: "Programar entrevista" });
  await schedule.getByLabel("Fecha").fill(limaDate(-1));
  await schedule.getByLabel("Hora").fill("11:00");
  await schedule.getByLabel("Modalidad").selectOption({ label: "Virtual" });
  await schedule.getByLabel("Enlace de la reunión").fill("https://meet.ejemplo.test/sala");
  await schedule.getByRole("button", { name: "Programar", exact: true }).click();
  await expect(page.getByText(/Entrevista programada\. La postulación quedó/)).toBeVisible();
  await expect(page.getByText("La evaluación del equipo se habilita cuando registres el resultado de esta entrevista.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Evaluar", exact: true })).toHaveCount(0);

  // --- 3. Resultado «No pasó»: la postulación se cierra y el candidato queda disponible.
  await page.goto("/entrevistas");
  const item = page.getByTestId("interview-item").filter({ hasText: candidateName });
  await item.getByRole("button", { name: "Registrar resultado" }).click();
  const result = page.getByRole("dialog", { name: "Registrar resultado" });
  await result.getByLabel("No pasó", { exact: true }).check();
  await result.getByLabel("Motivo (obligatorio)").fill("Le falta experiencia, pero es buen perfil");
  await result.getByRole("button", { name: "Registrar resultado" }).click();
  await expect(page.getByText(/Resultado registrado\. La postulación está en «No seleccionado»/)).toBeVisible();

  // --- 4. Evaluación del equipo sobre la entrevista realizada.
  await page.goto(`/postulaciones/${applicationId}`);
  const interviews = page.locator("#entrevistas");
  await expect(interviews.getByText("Evaluación del equipo")).toBeVisible();
  await expect(interviews.getByText("Aún no hay evaluaciones de esta entrevista.", { exact: false })).toBeVisible();
  await interviews.getByRole("button", { name: "Evaluar", exact: true }).click();
  const scorecard = page.getByRole("dialog", { name: "Evaluar al candidato" });
  for (const competency of ["Competencia técnica", "Comunicación", "Resolución de problemas", "Experiencia relevante", "Fit cultural / actitud"]) {
    await scorecard.getByRole("group", { name: competency }).getByRole("button", { name: "4", exact: true }).click();
  }
  await scorecard.getByRole("group", { name: "Recomendación" }).getByRole("button", { name: "Dudo" }).click();
  await scorecard.getByLabel("Comentario (opcional)").fill("Buen razonamiento; corroborar experiencia en la siguiente vacante.");
  await scorecard.getByRole("button", { name: "Guardar evaluación" }).click();
  await expect(page.getByText("Evaluación registrada.")).toBeVisible();
  await expect(interviews.getByText("4.0", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Resumen de evaluaciones")).toBeVisible();
  // Editar la propia evaluación (actualiza solo lo editable).
  await interviews.getByRole("button", { name: "Editar mi evaluación" }).click();
  const edit = page.getByRole("dialog", { name: "Editar mi evaluación" });
  await edit.getByRole("group", { name: "Recomendación" }).getByRole("button", { name: "Avanza", exact: true }).click();
  await edit.getByRole("button", { name: "Guardar evaluación" }).click();
  await expect(page.getByText("Evaluación actualizada.")).toBeVisible();
  await expect(interviews.getByText("Avanza", { exact: true }).first()).toBeVisible();

  // --- 5. Ficha: etiqueta de finalista y sin contactos todavía.
  await page.getByRole("link", { name: "Ver ficha y CV" }).click();
  // La postulación también muestra el nombre: se espera la URL de la ficha antes de guardarla.
  await page.waitForURL(/\/candidatos\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: candidateName })).toBeVisible();
  const candidateUrl = page.url().split("?")[0]!;
  await expect(page.getByText("Aún no se ha contactado a este candidato desde la base de talentos.")).toBeVisible();
  await page.getByLabel("Crear una etiqueta nueva").fill(tagName);
  await page.getByRole("button", { name: "Crear y asignar" }).click();
  await expect(page.getByText("Etiqueta creada y asignada.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Etiquetas del candidato" }).getByText(tagName)).toBeVisible();

  // --- 6. Pool de talento: se filtra por la etiqueta.
  await page.goto("/candidatos");
  await page.getByRole("link", { name: "Pool de talento" }).click();
  await expect(page).toHaveURL(/\/candidatos\/buscar/);
  await page.getByLabel("Etiqueta").selectOption({ label: tagName });
  await page.getByRole("button", { name: "Buscar" }).click();
  const poolRow = page.getByRole("row").filter({ hasText: candidateName });
  await expect(poolRow).toBeVisible();
  await expect(poolRow).toContainText(tagName);

  // --- 7. Vacante parecida: aparece entre los sugeridos; sin correo de respuestas no se puede invitar.
  // Punto de partida conocido: sin correo de respuestas (una corrida anterior pudo dejarlo puesto).
  await page.goto("/configuracion/plantillas-correo");
  const replyTo = page.getByLabel("Correo para respuestas");
  if ((await replyTo.inputValue()) !== "") {
    await replyTo.fill("");
    await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
    await expect(page.getByText("Correo de respuestas guardado.")).toBeVisible();
  }
  const targetUrl = await createVacancy(page, target, skill, false);
  await page.goto(`${targetUrl}?tab=candidatos`);
  const suggestions = page.locator("[data-slot='card']").filter({ hasText: "Candidatos de tu base que encajan" });
  const suggestion = suggestions.getByRole("row").filter({ hasText: candidateName });
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText("kestrel");
  await expect(suggestions.getByText("Falta el correo de respuestas")).toBeVisible();
  await suggestion.getByRole("checkbox").check();
  await expect(suggestions.getByRole("button", { name: "Invitar por correo" })).toBeDisabled();

  // --- 8. RRHH configura el correo de respuestas; la invitación es una plantilla editable.
  await page.goto("/configuracion/plantillas-correo");
  await expect(page.getByText("Invitación desde la base de talentos")).toBeVisible();
  await page.getByLabel("Correo para respuestas").fill("rrhh.respuestas@reclutamiento.test");
  await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
  await expect(page.getByText("Correo de respuestas guardado.")).toBeVisible();

  // --- 9. En las pruebas el correo está en modo de prueba: invitar avisa y no envía.
  await page.goto(`${targetUrl}?tab=candidatos`);
  await expect(suggestions.getByText("Falta el correo de respuestas")).toHaveCount(0);
  await suggestion.getByRole("checkbox").check();
  await suggestions.getByRole("button", { name: "Invitar por correo" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText(/No se pueden enviar invitaciones: modo de prueba/)).toBeVisible();
  await page.keyboard.press("Escape");

  // --- 10. Añadir al proceso en lote.
  await page.goto(`${targetUrl}?tab=candidatos`);
  await suggestion.getByRole("checkbox").check();
  await suggestions.getByRole("button", { name: "Añadir al proceso" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("1 añadido", { exact: true })).toBeVisible();
  await page.goto(`${targetUrl}?tab=candidatos`);
  await expect(page.getByRole("link", { name: candidateName, exact: true })).toBeVisible();
  await expect(suggestions.getByRole("row").filter({ hasText: candidateName })).toHaveCount(0);

  // --- 11. Historial de contacto en la ficha.
  await page.goto(candidateUrl);
  const history = page.getByRole("list", { name: "Historial de contacto" });
  await expect(history).toContainText("Reactivado desde la base");
  await expect(history).toContainText(`«${target}»`);
});

test("un administrador ve en la auditoría la reactivación y la etiqueta con frases legibles", async ({ page }, testInfo) => {
  test.skip(!admin.email || !admin.password || testInfo.project.name !== "escritorio", "Requiere usuario administrador.");
  await signIn(page, admin.email!, admin.password!);

  await page.goto("/auditoria?group=talento");
  await expect(page.getByText(`Añadió 1 candidato de la base de talentos a la vacante «${target}»`)).toBeVisible();
  await expect(page.getByText(`Asignó la etiqueta «${tagName}» a ${candidateName}`)).toBeVisible();
  await expect(page.getByText(`Creó la etiqueta «${tagName}» en la base de talentos`)).toBeVisible();

  await page.goto("/auditoria?group=postulaciones");
  await expect(page.getByText(`Reactivó desde la base de talentos a ${candidateName} en la vacante «${target}»`)).toBeVisible();
});
