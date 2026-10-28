import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { anon, asActor, createCandidate, createTestDatabase, createUser, expectError, user } from "./harness";

let db: PGlite;
let rrhh: string;
let inactive: string;
let candidateId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  inactive = await createUser(db, "rrhh", "Persona Desactivada");
  await db.query("update public.profiles set is_active = false where id = $1", [inactive]);
  candidateId = await createCandidate(db);
});

afterAll(async () => {
  await db?.close();
});

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "service_role" })]);
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

/** Registra un CV con la extracción indicada y devuelve el id del CV. */
async function registerResume(status: string, method: string, rawText: string | null = null): Promise<string> {
  const { rows } = await asActor(db, user(rrhh), () =>
    db.query<{ id: string }>(
      `with new_id as (select gen_random_uuid() as id)
       select (select id from new_id) as id,
         public.register_resume((select id from new_id), $1::uuid,
           'candidates/' || $1::text || '/' || (select id from new_id) || '.pdf',
           'cv.pdf', 'application/pdf', 1000, encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
           $2::public.extraction_status, $3, 'extractor-v1', $4, '{}'::jsonb, '{}', null)`,
      [candidateId, status, method, rawText],
    ),
  );
  return rows[0]!.id;
}

const OCR_TEXT = "Texto ficticio leído del escaneo con más de ochenta caracteres para que sea un resultado útil de OCR.";

function applyOcr(resumeId: string, status = "completada", text: string | null = OCR_TEXT, errorCode: string | null = null) {
  return db.query<{ applied: boolean }>(
    `select public.apply_resume_ocr($1::uuid, $2::public.extraction_status, 'ocr-local-tesseract7-spa', $3,
       '{"skills": []}'::jsonb, array['Aviso de OCR'], $4) as applied`,
    [resumeId, status, text, errorCode],
  );
}

async function extractionOf(resumeId: string) {
  const { rows } = await db.query<{
    status: string;
    method: string;
    extractor_version: string;
    raw_text: string | null;
    error_code: string | null;
    warnings: string[];
  }>("select status, method, extractor_version, raw_text, error_code, warnings from public.resume_extractions where resume_id = $1", [
    resumeId,
  ]);
  return rows[0]!;
}

describe("método pdf_ocr", () => {
  it("las tablas de extracción y de lotes admiten pdf_ocr y siguen rechazando otros métodos", async () => {
    const id = await registerResume("completada", "pdf_ocr", OCR_TEXT);
    expect((await extractionOf(id)).method).toBe("pdf_ocr");
    await expectError(registerResume("completada", "otro_metodo", OCR_TEXT));
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'public.intake_batch_items'::regclass and conname = 'intake_batch_items_extraction_method_check'`,
    );
    expect(rows[0]?.def).toContain("pdf_ocr");
  });
});

describe("apply_resume_ocr", () => {
  it("guarda el resultado en un CV pdf_text + sin_texto", async () => {
    const id = await registerResume("sin_texto", "pdf_text");
    const applied = await asActor(db, user(rrhh), () => applyOcr(id));
    expect(applied.rows[0]!.applied).toBe(true);
    expect(await extractionOf(id)).toMatchObject({
      status: "completada",
      method: "pdf_ocr",
      extractor_version: "ocr-local-tesseract7-spa",
      raw_text: OCR_TEXT,
      error_code: null,
      warnings: ["Aviso de OCR"],
    });
  });

  it("no actualiza una extracción que ya tiene texto", async () => {
    const id = await registerResume("completada", "pdf_text", OCR_TEXT);
    expect((await asActor(db, user(rrhh), () => applyOcr(id))).rows[0]!.applied).toBe(false);
    expect((await extractionOf(id)).method).toBe("pdf_text");
    // Tampoco repite sobre un resultado de OCR completado.
    const ocrDone = await registerResume("sin_texto", "pdf_text");
    await asActor(db, user(rrhh), () => applyOcr(ocrDone));
    expect((await asActor(db, user(rrhh), () => applyOcr(ocrDone))).rows[0]!.applied).toBe(false);
  });

  it("permite reintentar sobre pdf_ocr + sin_texto (intento fallido o sin texto útil)", async () => {
    const id = await registerResume("sin_texto", "pdf_text");
    expect((await asActor(db, user(rrhh), () => applyOcr(id, "sin_texto", null, "ocr_fallido"))).rows[0]!.applied).toBe(true);
    expect(await extractionOf(id)).toMatchObject({ status: "sin_texto", method: "pdf_ocr", error_code: "ocr_fallido", raw_text: null });
    expect((await asActor(db, user(rrhh), () => applyOcr(id))).rows[0]!.applied).toBe(true);
    expect((await extractionOf(id)).status).toBe("completada");
  });

  it("nunca pisa el texto corregido por RRHH", async () => {
    const id = await registerResume("sin_texto", "pdf_text");
    await db.query("update public.resume_extractions set corrected_text = 'Transcripción de RRHH' where resume_id = $1", [id]);
    expect((await asActor(db, user(rrhh), () => applyOcr(id))).rows[0]!.applied).toBe(false);
    const { rows } = await db.query<{ corrected_text: string; method: string; status: string }>(
      "select corrected_text, method, status from public.resume_extractions where resume_id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ corrected_text: "Transcripción de RRHH", method: "pdf_text", status: "sin_texto" });
  });

  it("sin_texto nunca pierde un texto digital parcial; completada sí lo reemplaza", async () => {
    const digital = "Persona Ficticia Rojas. Experiencia con SQL Server y reportes.";
    const id = await registerResume("sin_texto", "pdf_text", digital);
    const apply = (status: string, text: string | null, code: string | null = null) =>
      asActor(db, user(rrhh), () => applyOcr(id, status, text, code));

    // Fallido o sin texto útil (nulo o más corto): se conserva, pero queda marcado el intento.
    expect((await apply("sin_texto", null, "ocr_fallido")).rows[0]!.applied).toBe(true);
    expect(await extractionOf(id)).toMatchObject({ method: "pdf_ocr", error_code: "ocr_fallido", raw_text: digital });
    await apply("sin_texto", "Persona");
    expect((await extractionOf(id)).raw_text).toBe(digital);
    // Un texto más largo sí reemplaza al parcial aunque siga sin ser útil.
    const longer = `${digital} Formación en ingeniería industrial.`;
    await apply("sin_texto", longer);
    expect((await extractionOf(id)).raw_text).toBe(longer);
    // Con `completada` se reemplaza como siempre, aunque sea más corto.
    await apply("completada", "Texto leído por OCR, distinto y más corto que el anterior pero completo para el caso.");
    expect(await extractionOf(id)).toMatchObject({
      status: "completada",
      raw_text: "Texto leído por OCR, distinto y más corto que el anterior pero completo para el caso.",
    });
  });

  it("sin texto previo, sin_texto guarda lo que llegue", async () => {
    const id = await registerResume("sin_texto", "pdf_text");
    await asActor(db, user(rrhh), () => applyOcr(id, "sin_texto", "Algo corto"));
    expect((await extractionOf(id)).raw_text).toBe("Algo corto");
  });

  it("no toca extracciones de DOCX", async () => {
    const id = await registerResume("sin_texto", "docx_text");
    expect((await asActor(db, user(rrhh), () => applyOcr(id))).rows[0]!.applied).toBe(false);
    expect((await extractionOf(id)).method).toBe("docx_text");
  });

  it("valida estado, texto y longitudes", async () => {
    const id = await registerResume("sin_texto", "pdf_text");
    await expectError(asActor(db, user(rrhh), () => applyOcr(id, "fallida", null)));
    await expectError(asActor(db, user(rrhh), () => applyOcr(id, "completada", null)));
    await expectError(asActor(db, user(rrhh), () => applyOcr(id, "completada", "x".repeat(200_001))));
    await expectError(asActor(db, user(rrhh), () => applyOcr(id, "sin_texto", null, "e".repeat(65))));
    expect((await extractionOf(id)).method).toBe("pdf_text");
  });

  it("un CV inexistente es un error", async () => {
    await expectError(asActor(db, user(rrhh), () => applyOcr("00000000-0000-0000-0000-000000000000")));
  });

  it("solo la clave de servicio o el personal con acceso pueden usarla", async () => {
    const id = await registerResume("sin_texto", "pdf_text");
    await expectError(asActor(db, anon, () => applyOcr(id)));
    await expectError(asActor(db, user(inactive), () => applyOcr(id)));
    expect((await extractionOf(id)).method).toBe("pdf_text");
    expect((await asService(() => applyOcr(id))).rows[0]!.applied).toBe(true);
    expect((await extractionOf(id)).method).toBe("pdf_ocr");
  });
});

describe("límite cv_ocr", () => {
  it("permite 20 lecturas cada 10 minutos por usuario y rechaza la 21", async () => {
    const results = await asActor(db, user(rrhh), async () => {
      const values: boolean[] = [];
      for (let i = 0; i < 21; i += 1) {
        const { rows } = await db.query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit('cv_ocr')");
        values.push(rows[0]!.consume_rate_limit);
      }
      return values;
    });
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results[20]).toBe(false);
    // Los demás tipos conservan su límite.
    const bulk = await asActor(db, user(rrhh), () => db.query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit('evaluation_bulk')"));
    expect(bulk.rows[0]!.consume_rate_limit).toBe(true);
  });
});
