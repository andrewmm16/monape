import { normalizeTerm } from "./text";

/**
 * Equivalencias de evidencia: expresiones que, para demostrar un requisito,
 * significan lo mismo. No incluye hiperónimos de área ni términos meramente
 * relacionados, ni software con nombre propio. «Comercial» NO es equivalente de «ventas»: describe
 * a la empresa o al área, no que el candidato venda (lo demuestra el banco adversario).
 */
export const EQUIVALENCE_GROUPS: ReadonlyArray<{
  concepto: string;
  equivalentes: readonly string[];
  /**
   * Expresiones que DEMUESTRAN el concepto pero no al revés (reglas-v11): un
   * contador hace contabilidad, pero quien hace tareas contables no es contador.
   * Se buscan al pedir el concepto; pedirlas a ellas no expande al grupo.
   */
  implicados?: readonly string[];
}> = [
  {
    concepto: "contabilidad",
    equivalentes: [
      "contabilidad",
      "contable",
      "libros contables",
      "registros contables",
    ],
    implicados: ["contador", "contador público", "contador general"],
  },
  {
    concepto: "atención al cliente",
    equivalentes: [
      "atención al cliente",
      "atención al público",
      "servicio al cliente",
    ],
  },
  {
    concepto: "tecnologías de la información",
    equivalentes: ["tecnologías de la información", "TI"],
  },
  {
    // PLE es el nombre SUNAT del «Programa de Libros Electrónicos»: quien lleva
    // libros electrónicos usa PLE. Excepción justificada a «sin software con nombre
    // propio», porque es la misma evidencia escrita de dos formas, no un hiperónimo.
    concepto: "PLE",
    equivalentes: ["PLE", "libros electrónicos", "programa de libros electrónicos"],
  },
  // reglas-v15 (banco ciego 2, puestos operativos): el mismo trabajo de almacén
  // con otro nombre de cargo. Jefe o supervisor de almacén NO entran: es otro
  // nivel de responsabilidad (ver related.ts).
  {
    concepto: "operario de almacén",
    equivalentes: [
      "operario de almacén",
      "operaria de almacén",
      "auxiliar de almacén",
      "asistente de almacén",
      "ayudante de almacén",
      "almacenero",
      "almacenera",
    ],
  },
  // Quien trabajó de vendedor tiene experiencia en ventas (no al revés: «ventas»
  // puede ser el área). «Comercial» sigue sin contar (ver arriba).
  {
    concepto: "ventas",
    equivalentes: ["ventas"],
    implicados: ["vendedor", "vendedora", "asesor de ventas", "asesora de ventas"],
  },
  // Emitir comprobantes electrónicos ES usar la facturación electrónica de SUNAT.
  {
    concepto: "facturación electrónica",
    equivalentes: [
      "facturación electrónica",
      "facturas electrónicas",
      "boletas electrónicas",
      "comprobantes electrónicos",
      "comprobantes de pago electrónicos",
    ],
  },
  // reglas-v14: siglas de los colegios profesionales del Perú («CEP N.º 000000»).
  // La colegiatura es un requisito legal: la sigla la encuentra, pero el motor la
  // deja para verificar con documentos, como el nombre completo. Se omiten las
  // siglas que también son palabras comunes (CAP, CAL, COP).
  { concepto: "Colegio de Enfermeros", equivalentes: ["Colegio de Enfermeros", "Colegio de Enfermeros del Perú", "CEP"] },
  { concepto: "Colegio de Ingenieros", equivalentes: ["Colegio de Ingenieros", "Colegio de Ingenieros del Perú", "CIP"] },
  { concepto: "Colegio Médico", equivalentes: ["Colegio Médico", "Colegio Médico del Perú", "CMP"] },
  {
    concepto: "Colegio de Contadores",
    equivalentes: ["Colegio de Contadores", "Colegio de Contadores Públicos", "Colegio de Contadores Públicos de Lima", "CCPL"],
  },
  { concepto: "Colegio de Psicólogos", equivalentes: ["Colegio de Psicólogos", "Colegio de Psicólogos del Perú", "CPsP"] },
  { concepto: "Colegio Químico Farmacéutico", equivalentes: ["Colegio Químico Farmacéutico", "Colegio Químico Farmacéutico del Perú", "CQFP"] },
  { concepto: "Colegio Tecnólogo Médico", equivalentes: ["Colegio Tecnólogo Médico", "Colegio Tecnólogo Médico del Perú", "CTMP"] },
];

/**
 * Expresiones equivalentes de `term`, sin incluirlo, de-duplicadas por
 * `normalizeTerm`. `[]` si no pertenece a ningún grupo.
 */
export function equivalentsFor(term: string): string[] {
  return equivalentsIn(EQUIVALENCE_GROUPS, term);
}

/**
 * Solo las siglas de los colegios profesionales (reglas-v14). Las usan los
 * requisitos de formación y de certificación, que no buscan el resto de las
 * equivalencias: ahí «contable» no debe valer por «Contabilidad».
 */
export function collegeEquivalentsFor(term: string): string[] {
  return equivalentsIn(
    EQUIVALENCE_GROUPS.filter((group) => group.concepto.startsWith("Colegio")),
    term,
  );
}

function equivalentsIn(groups: typeof EQUIVALENCE_GROUPS, term: string): string[] {
  const key = normalizeTerm(term);
  const seen = new Set<string>([key]);
  const out: string[] = [];
  for (const group of groups) {
    if (!group.equivalentes.some((e) => normalizeTerm(e) === key)) continue;
    for (const e of [...group.equivalentes, ...(group.implicados ?? [])]) {
      const n = normalizeTerm(e);
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(e);
    }
  }
  return out;
}
