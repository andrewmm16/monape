// LA VARA (gold standard por requisito).
//
// Para cada casilla (CV × requisito) fija el veredicto CORRECTO, derivado de leer
// el contenido del CV (scripts/generar-cv-prueba.ts) frente al requisito
// (datos.ts), NUNCA de lo que el motor responde. El medidor (gold.ts) compara esta
// vara con la salida del motor y cuenta aciertos, sobre-acreditación y mérito
// perdido.
//
// Reglas de etiquetado (ver docs/superpowers/specs/2026-11-16-gold-standard-requisito-design.md):
//   - acreditado           → cumple nivel y, si aplica, el mínimo de años.
//   - pendiente (legal)     → requisito legal/esencial declarado (colegiaturas): RRHH verifica documento.
//   - pendiente (parcial)   → hay evidencia pero por debajo de lo pedido (nivel/años/estudios en curso/"nociones").
//   - pendiente (competencia) → competencia declarada en el CV: nunca se acredita por mención, se verifica en entrevista.
//   - no_cumplido           → SOLO negación explícita ("no cuento con experiencia en X").
//   - sin_evidencia         → no lo menciona.
//
// `revisar: true` marca las casillas cuyo matiz es discutible; el medidor las cuenta
// aparte y NO contaminan las métricas hasta que Omar les dé el visto bueno.

import type { Assessment } from "../../src/modules/evaluation/types";

/** Por qué un `pendiente_verificacion`: requisito legal, cumplimiento parcial o competencia declarada. */
export type MotivoPendiente = "legal" | "parcial" | "competencia";

export type GoldCell = {
  assessment: Assessment;
  /** De dónde sale el veredicto, en pocas palabras. */
  nota: string;
  /** Matiz discutible: fuera de las métricas hasta el visto bueno de Omar. */
  revisar?: boolean;
  /** Solo en pendiente_verificacion: distingue legal, parcial y competencia. */
  motivo?: MotivoPendiente;
};

/** reqId → veredicto esperado. */
export type GoldCandidato = Record<string, GoldCell>;

/** archivo de CV → sus casillas. */
export const GOLD: Record<string, GoldCandidato> = {
  // ───────────────────────── Puesto 1 · Asistente Contable ─────────────────────────
  "CV_Quispe_Carmen.pdf": {
    "p1-r1": { assessment: "acreditado", nota: "Contadora Pública titulada." },
    "p1-r2": { assessment: "acreditado", nota: "~6 años en contabilidad general." },
    "p1-r3": { assessment: "acreditado", nota: "IGV, renta, PDT 621, SUNAT." },
    "p1-r4": { assessment: "acreditado", nota: "Excel avanzado (tablas dinámicas, BUSCARV)." },
    "p1-r5": { assessment: "pendiente_verificacion", motivo: "legal", nota: "Declara colegiatura CCP Lima; verificar documento." },
    "p1-r6": { assessment: "acreditado", nota: "SAP Business One." },
    "p1-r7": { assessment: "acreditado", nota: "Libros electrónicos (PLE) y PLAME." },
    "p1-r8": { assessment: "acreditado", nota: "Conciliaciones bancarias." },
    "p1-r9": { assessment: "acreditado", nota: "Registró >800 comprobantes mensuales." },
  },
  "CV_Mendoza_Luis.pdf": {
    "p1-r1": { assessment: "acreditado", nota: "Bachiller en Contabilidad." },
    "p1-r2": { assessment: "acreditado", nota: "~3-4 años como auxiliar/practicante contable." },
    "p1-r3": { assessment: "acreditado", nota: "PDT 621 e IGV (aunque 'nociones de tributación')." },
    "p1-r4": { assessment: "acreditado", nota: "Excel intermedio-avanzado." },
    "p1-r5": { assessment: "sin_evidencia", nota: "Bachiller, no declara colegiatura." },
    "p1-r6": { assessment: "acreditado", nota: "Concar." },
    "p1-r7": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Libros electrónicos (PLE) pero no nombra PLAME." },
    "p1-r8": { assessment: "acreditado", nota: "Conciliaciones bancarias de 3 cuentas." },
    "p1-r9": { assessment: "sin_evidencia", nota: "Registra compras/ventas, no emisión de comprobantes." },
  },
  "CV_Salazar_Patricia.pdf": {
    "p1-r1": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Contabilidad en curso (6º ciclo), sin título/bachiller." },
    "p1-r2": { assessment: "sin_evidencia", nota: "Experiencia administrativa/caja, no contable." },
    "p1-r3": { assessment: "sin_evidencia", nota: "No menciona tributación." },
    "p1-r4": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Excel básico-intermedio, por debajo de int-avanzado." },
    "p1-r5": { assessment: "sin_evidencia", nota: "No declara colegiatura." },
    "p1-r6": { assessment: "sin_evidencia", nota: "No menciona SAP ni Concar." },
    "p1-r7": { assessment: "sin_evidencia", nota: "No menciona PLE ni PLAME." },
    "p1-r8": { assessment: "sin_evidencia", nota: "No menciona conciliaciones." },
    "p1-r9": { assessment: "acreditado", nota: "Emite facturas y boletas electrónicas." },
  },
  "CV_Paredes_Jorge.pdf": {
    "p1-r1": { assessment: "sin_evidencia", nota: "Técnico mecánico, no contabilidad." },
    "p1-r2": { assessment: "sin_evidencia", nota: "Sin experiencia contable." },
    "p1-r3": { assessment: "sin_evidencia", nota: "No menciona tributación." },
    "p1-r4": { assessment: "sin_evidencia", nota: "Word básico, no Excel." },
    "p1-r5": { assessment: "sin_evidencia", nota: "No declara colegiatura." },
    "p1-r6": { assessment: "sin_evidencia", nota: "No menciona SAP ni Concar." },
    "p1-r7": { assessment: "sin_evidencia", nota: "No menciona PLE ni PLAME." },
    "p1-r8": { assessment: "sin_evidencia", nota: "No menciona conciliaciones." },
    "p1-r9": { assessment: "sin_evidencia", nota: "No menciona comprobantes." },
  },

  // ───────────────────────── Puesto 2 · Ejecutivo Comercial B2B ─────────────────────────
  "CV_Vargas_Andrea.pdf": {
    "p2-r1": { assessment: "acreditado", nota: "~7 años en ventas." },
    "p2-r2": { assessment: "acreditado", nota: "Ventas B2B consultivas, cuentas clave, contratos marco." },
    "p2-r3": { assessment: "acreditado", nota: "Superó meta anual 118/122/112%." },
    "p2-r4": { assessment: "acreditado", nota: "CRM HubSpot y Salesforce." },
    "p2-r5": { assessment: "acreditado", nota: "Administración de Empresas (título)." },
    "p2-r6": { assessment: "acreditado", nota: "Sector industrial y minero." },
    "p2-r7": { assessment: "acreditado", nota: "Negoció contratos marco." },
    "p2-r8": { assessment: "acreditado", nota: "Inglés avanzado (C1)." },
    "p2-r9": { assessment: "acreditado", nota: "Excel avanzado." },
  },
  "CV_Chavez_Diego.pdf": {
    "p2-r1": { assessment: "acreditado", nota: "~4-6 años en ventas." },
    "p2-r2": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Vende a bodegas/supermercados, no es B2B de cuentas clave." },
    "p2-r3": { assessment: "acreditado", nota: "Cumplí 104% de meta trimestral." },
    "p2-r4": { assessment: "acreditado", nota: "CRM Zoho." },
    "p2-r5": { assessment: "acreditado", nota: "Marketing (técnico profesional)." },
    "p2-r6": { assessment: "sin_evidencia", nota: "Consumo masivo, no industrial/minero." },
    "p2-r7": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "'Negociación básica', no negociación de contratos." },
    "p2-r8": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Inglés básico (A2), por debajo de intermedio." },
    "p2-r9": { assessment: "acreditado", nota: "Excel intermedio (cubre nivel usuario)." },
  },
  "CV_Espinoza_Rocio.pdf": {
    "p2-r1": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Fechas suman ~4.8 años (ella declara 2): cumple el mínimo por fechas, no por texto. RRHH confirma y revisa la discrepancia años declarados vs fechas." },
    "p2-r2": { assessment: "sin_evidencia", nota: "Retail a cliente final; aspira a B2B, no lo tiene." },
    "p2-r3": { assessment: "sin_evidencia", nota: "'Vendedora del mes', sin metas cuantificadas." },
    "p2-r4": { assessment: "sin_evidencia", nota: "No menciona CRM." },
    "p2-r5": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Administración en curso (4º ciclo)." },
    "p2-r6": { assessment: "sin_evidencia", nota: "No industrial/minero." },
    "p2-r7": { assessment: "sin_evidencia", nota: "No menciona negociación de contratos." },
    "p2-r8": { assessment: "sin_evidencia", nota: "Solo español." },
    "p2-r9": { assessment: "acreditado", nota: "Excel básico cubre nivel usuario." },
  },
  "CV_Gutierrez_Fernando.pdf": {
    "p2-r1": { assessment: "sin_evidencia", nota: "Técnico enfermería, no ventas." },
    "p2-r2": { assessment: "sin_evidencia", nota: "Sin ventas B2B." },
    "p2-r3": { assessment: "sin_evidencia", nota: "Sin metas comerciales." },
    "p2-r4": { assessment: "sin_evidencia", nota: "No menciona CRM." },
    "p2-r5": { assessment: "sin_evidencia", nota: "Formación en enfermería, no admin/marketing." },
    "p2-r6": { assessment: "sin_evidencia", nota: "No industrial/minero." },
    "p2-r7": { assessment: "sin_evidencia", nota: "No menciona negociación de contratos." },
    "p2-r8": { assessment: "sin_evidencia", nota: "Solo español." },
    "p2-r9": { assessment: "sin_evidencia", nota: "No menciona Excel." },
  },

  // ───────────────────────── Puesto 3 · Desarrollador Web Full Stack ─────────────────────────
  "CV_Ramirez_Sebastian.pdf": {
    "p3-r1": { assessment: "acreditado", nota: "~6 años full stack." },
    "p3-r2": { assessment: "acreditado", nota: "React y Next.js." },
    "p3-r3": { assessment: "acreditado", nota: "TypeScript/JavaScript." },
    "p3-r4": { assessment: "acreditado", nota: "Node.js." },
    "p3-r5": { assessment: "acreditado", nota: "PostgreSQL y SQL." },
    "p3-r6": { assessment: "acreditado", nota: "Git y GitHub Actions." },
    "p3-r7": { assessment: "acreditado", nota: "Next.js y PostgreSQL/Supabase." },
    "p3-r8": { assessment: "acreditado", nota: "Jest, Playwright, CI/CD." },
    "p3-r9": { assessment: "acreditado", nota: "Inglés avanzado (C1)." },
  },
  "CV_Ortiz_Valeria.pdf": {
    "p3-r1": { assessment: "acreditado", nota: "~3-4 años como desarrolladora." },
    "p3-r2": { assessment: "acreditado", nota: "React." },
    "p3-r3": { assessment: "acreditado", nota: "JavaScript (TypeScript básico)." },
    "p3-r4": { assessment: "acreditado", nota: "Node.js (Express)." },
    "p3-r5": { assessment: "acreditado", nota: "MySQL." },
    "p3-r6": { assessment: "acreditado", nota: "Git." },
    "p3-r7": { assessment: "sin_evidencia", nota: "No Next.js ni PostgreSQL (usa MySQL)." },
    "p3-r8": { assessment: "sin_evidencia", nota: "No menciona pruebas automatizadas ni CI/CD." },
    "p3-r9": { assessment: "acreditado", nota: "Inglés intermedio (B1)." },
  },
  "CV_Navarro_Hugo.pdf": {
    "p3-r1": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "~1.7 años como dev, por debajo de 3." },
    "p3-r2": { assessment: "sin_evidencia", nota: "WordPress/PHP, no React." },
    "p3-r3": { assessment: "acreditado", nota: "JavaScript (básico, pero el requisito no fija nivel)." },
    "p3-r4": { assessment: "sin_evidencia", nota: "No menciona Node.js." },
    "p3-r5": { assessment: "acreditado", nota: "MySQL básico (requisito no fija nivel)." },
    "p3-r6": { assessment: "sin_evidencia", nota: "No menciona Git." },
    "p3-r7": { assessment: "sin_evidencia", nota: "No Next.js ni PostgreSQL." },
    "p3-r8": { assessment: "sin_evidencia", nota: "No menciona pruebas ni CI/CD." },
    "p3-r9": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Inglés básico (A2), por debajo de intermedio." },
  },
  "CV_Fuentes_Milagros.pdf": {
    "p3-r1": { assessment: "no_cumplido", nota: "Dice explícitamente 'sin experiencia en programación'." },
    "p3-r2": { assessment: "sin_evidencia", nota: "No React." },
    "p3-r3": { assessment: "sin_evidencia", nota: "No JS/TS." },
    "p3-r4": { assessment: "sin_evidencia", nota: "No Node.js." },
    "p3-r5": { assessment: "sin_evidencia", nota: "No SQL." },
    "p3-r6": { assessment: "sin_evidencia", nota: "No Git." },
    "p3-r7": { assessment: "sin_evidencia", nota: "No Next.js/PostgreSQL." },
    "p3-r8": { assessment: "sin_evidencia", nota: "No pruebas/CI-CD." },
    "p3-r9": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Inglés básico (A2), por debajo de intermedio." },
  },

  // ───────────────────────── Puesto 4 · Coordinador de Logística ─────────────────────────
  "CV_Villanueva_Ricardo.pdf": {
    "p4-r1": { assessment: "acreditado", nota: "Ingeniería Industrial (título)." },
    "p4-r2": { assessment: "acreditado", nota: "~8 años en logística/almacén." },
    "p4-r3": { assessment: "acreditado", nota: "Gestión de inventarios, conteos cíclicos." },
    "p4-r4": { assessment: "acreditado", nota: "Excel avanzado e indicadores (KPI)." },
    "p4-r5": { assessment: "acreditado", nota: "Dirigió equipo de 14 personas." },
    "p4-r6": { assessment: "acreditado", nota: "WMS y ERP (SAP MM)." },
    "p4-r7": { assessment: "acreditado", nota: "Negociación/renegociación con proveedores." },
    "p4-r8": { assessment: "sin_evidencia", nota: "No menciona trabajo bajo presión." },
    "p4-r9": { assessment: "acreditado", nota: "Inglés intermedio (B2)." },
  },
  "CV_Castaneda_Elena.pdf": {
    "p4-r1": { assessment: "acreditado", nota: "Administración y Logística (técnico)." },
    "p4-r2": { assessment: "acreditado", nota: "~4-6 años en almacén/distribución." },
    "p4-r3": { assessment: "acreditado", nota: "Controló inventarios de 1,500 SKU." },
    "p4-r4": { assessment: "acreditado", nota: "Excel intermedio-avanzado cubre 'avanzado'." },
    "p4-r5": { assessment: "sin_evidencia", nota: "Coordina transportistas, no lidera un equipo." },
    "p4-r6": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "'ERP básico', no nombra WMS ni SAP." },
    "p4-r7": { assessment: "sin_evidencia", nota: "No menciona negociación con proveedores." },
    "p4-r8": { assessment: "pendiente_verificacion", motivo: "competencia", nota: "Declara trabajo bajo presión; una competencia se verifica en entrevista." },
    "p4-r9": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Inglés básico (A2), por debajo de B2." },
  },
  "CV_Moreno_Cesar.pdf": {
    "p4-r1": { assessment: "sin_evidencia", nota: "Secundaria; curso de montacargas, no logística formal." },
    "p4-r2": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Fechas suman ~4-5 años en almacén/reparto: cumple el mínimo por fechas. RRHH confirma." },
    "p4-r3": { assessment: "acreditado", nota: "Apoyo en inventarios anuales." },
    "p4-r4": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Excel básico, por debajo de avanzado." },
    "p4-r5": { assessment: "sin_evidencia", nota: "No lidera equipos." },
    "p4-r6": { assessment: "sin_evidencia", nota: "No menciona WMS ni SAP." },
    "p4-r7": { assessment: "sin_evidencia", nota: "No menciona negociación." },
    "p4-r8": { assessment: "sin_evidencia", nota: "No menciona trabajo bajo presión." },
    "p4-r9": { assessment: "sin_evidencia", nota: "Solo español." },
  },
  "CV_Bustamante_Natalia.pdf": {
    "p4-r1": { assessment: "sin_evidencia", nota: "Psicología, no logística." },
    "p4-r2": { assessment: "sin_evidencia", nota: "Sin experiencia en almacén/distribución." },
    "p4-r3": { assessment: "sin_evidencia", nota: "No menciona inventarios." },
    "p4-r4": { assessment: "sin_evidencia", nota: "No menciona Excel." },
    "p4-r5": { assessment: "sin_evidencia", nota: "No lidera equipos de almacén." },
    "p4-r6": { assessment: "sin_evidencia", nota: "No WMS/SAP." },
    "p4-r7": { assessment: "sin_evidencia", nota: "No negociación con proveedores." },
    "p4-r8": { assessment: "sin_evidencia", nota: "No menciona trabajo bajo presión." },
    "p4-r9": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Inglés intermedio (B1), por debajo de B2." },
  },

  // ───────────────────────── Puesto 5 · Analista de Atención al Cliente ─────────────────────────
  "CV_Ccopa_Daniela.pdf": {
    "p5-r1": { assessment: "acreditado", nota: "Administración de Servicios (título)." },
    "p5-r2": { assessment: "acreditado", nota: "~5 años en contact center/postventa." },
    "p5-r3": { assessment: "acreditado", nota: "Gestión de reclamos y quejas." },
    "p5-r4": { assessment: "acreditado", nota: "Zendesk y CRM." },
    "p5-r5": { assessment: "acreditado", nota: "NPS, CSAT, TMO." },
    "p5-r6": { assessment: "acreditado", nota: "Capacitó a 18 asesores." },
    "p5-r7": { assessment: "acreditado", nota: "Inglés intermedio (B2)." },
    "p5-r8": { assessment: "pendiente_verificacion", motivo: "competencia", nota: "Declara comunicación asertiva; una competencia se verifica en entrevista." },
    "p5-r9": { assessment: "acreditado", nota: ">80 llamadas diarias." },
  },
  "CV_Huertas_Marco.pdf": {
    "p5-r1": { assessment: "acreditado", nota: "Administración (egresado)." },
    "p5-r2": { assessment: "acreditado", nota: "~3-5 años en servicio al cliente." },
    "p5-r3": { assessment: "sin_evidencia", nota: "Atiende consultas; no gestión de reclamos explícita." },
    "p5-r4": { assessment: "acreditado", nota: "CRM Freshdesk." },
    "p5-r5": { assessment: "sin_evidencia", nota: "No menciona NPS/CSAT." },
    "p5-r6": { assessment: "sin_evidencia", nota: "No menciona capacitar equipos." },
    "p5-r7": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Inglés básico (A2), por debajo de intermedio." },
    "p5-r8": { assessment: "sin_evidencia", nota: "No menciona comunicación asertiva." },
    "p5-r9": { assessment: "acreditado", nota: "Atención telefónica y chat." },
  },
  "CV_Torres_Yesenia.pdf": {
    "p5-r1": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Secretariado ejecutivo en curso." },
    "p5-r2": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "~1.5 años en recepción, por debajo de 3 y no contact center." },
    "p5-r3": { assessment: "no_cumplido", nota: "Dice explícitamente 'sin experiencia en reclamos'." },
    "p5-r4": { assessment: "no_cumplido", nota: "Dice explícitamente 'sin experiencia en sistemas CRM'." },
    "p5-r5": { assessment: "sin_evidencia", nota: "No menciona NPS/CSAT." },
    "p5-r6": { assessment: "sin_evidencia", nota: "No menciona capacitar equipos." },
    "p5-r7": { assessment: "sin_evidencia", nota: "Solo español." },
    "p5-r8": { assessment: "sin_evidencia", nota: "No menciona comunicación asertiva." },
    "p5-r9": { assessment: "acreditado", nota: "Atención de llamadas y visitas." },
  },
  "CV_Lozano_Oscar.pdf": {
    "p5-r1": { assessment: "sin_evidencia", nota: "Secundaria completa, no téc/univ." },
    "p5-r2": { assessment: "sin_evidencia", nota: "Chofer, no atención al cliente." },
    "p5-r3": { assessment: "sin_evidencia", nota: "No gestión de reclamos." },
    "p5-r4": { assessment: "sin_evidencia", nota: "No CRM." },
    "p5-r5": { assessment: "sin_evidencia", nota: "No NPS/CSAT." },
    "p5-r6": { assessment: "sin_evidencia", nota: "No capacitar equipos." },
    "p5-r7": { assessment: "sin_evidencia", nota: "Solo español." },
    "p5-r8": { assessment: "sin_evidencia", nota: "No comunicación asertiva." },
    "p5-r9": { assessment: "sin_evidencia", nota: "No atención de llamadas/chat." },
  },

  // ───────────────────────── Puesto 6 · Enfermera(o) Asistencial ─────────────────────────
  "CV_Ticona_Rosa.pdf": {
    "p6-r1": { assessment: "acreditado", nota: "Licenciada en Enfermería (título)." },
    "p6-r2": { assessment: "pendiente_verificacion", motivo: "legal", nota: "Declara colegiatura CEP vigente; verificar documento." },
    "p6-r3": { assessment: "acreditado", nota: "~7 años hospitalaria (4 en UCI)." },
    "p6-r4": { assessment: "acreditado", nota: "UCI / cuidados intensivos." },
    "p6-r5": { assessment: "acreditado", nota: "Soporte vital básico y avanzado (RCP)." },
  },
  "CV_Caceres_Milagros.pdf": {
    "p6-r1": { assessment: "acreditado", nota: "Licenciada en Enfermería (título)." },
    "p6-r2": { assessment: "pendiente_verificacion", motivo: "legal", nota: "Declara colegiatura CEP; verificar documento." },
    "p6-r3": { assessment: "acreditado", nota: "~3 años en hospitalización/consulta externa." },
    "p6-r4": { assessment: "sin_evidencia", nota: "Hospitalización general, no UCI/emergencia." },
    "p6-r5": { assessment: "acreditado", nota: "Soporte vital básico (RCP)." },
  },
  "CV_Huanca_Nancy.pdf": {
    "p6-r1": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Técnica en Enfermería, NO licenciada (escalera de grados)." },
    "p6-r2": { assessment: "sin_evidencia", nota: "Técnica: no declara colegiatura CEP." },
    "p6-r3": { assessment: "acreditado", nota: "~4 años apoyando pacientes hospitalizados." },
    "p6-r4": { assessment: "sin_evidencia", nota: "No UCI/emergencia." },
    "p6-r5": { assessment: "sin_evidencia", nota: "No menciona RCP/soporte vital." },
  },
  "CV_Cordova_Diana.pdf": {
    "p6-r1": { assessment: "sin_evidencia", nota: "Secretariado, no enfermería." },
    "p6-r2": { assessment: "sin_evidencia", nota: "No declara colegiatura." },
    "p6-r3": { assessment: "sin_evidencia", nota: "Admisión/recepción, no asistencial hospitalaria." },
    "p6-r4": { assessment: "sin_evidencia", nota: "No UCI/emergencia." },
    "p6-r5": { assessment: "sin_evidencia", nota: "No RCP/soporte vital." },
  },

  // ───────────────────────── Puesto 7 · Asistente de Planillas ─────────────────────────
  "CV_Vilca_Katherine.pdf": {
    "p7-r1": { assessment: "acreditado", nota: "Bachiller en Administración." },
    "p7-r2": { assessment: "acreditado", nota: "~5 años en planillas/remuneraciones." },
    "p7-r3": { assessment: "acreditado", nota: "PLAME y T-Registro." },
    "p7-r4": { assessment: "acreditado", nota: "Legislación laboral: CTS, gratificaciones, liquidaciones." },
    "p7-r5": { assessment: "acreditado", nota: "Excel avanzado (macros, tablas dinámicas)." },
    "p7-r6": { assessment: "acreditado", nota: "AFPnet (AFP y ONP)." },
  },
  "CV_Chuquilin_Elmer.pdf": {
    "p7-r1": { assessment: "acreditado", nota: "Técnico en Administración de Empresas." },
    "p7-r2": { assessment: "acreditado", nota: "~2 años en apoyo a planillas (cumple el mínimo justo)." },
    "p7-r3": { assessment: "acreditado", nota: "PLAME y T-Registro." },
    "p7-r4": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "'Nociones de legislación laboral'; no menciona CTS/liquidaciones." },
    "p7-r5": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Excel intermedio, por debajo de avanzado." },
    "p7-r6": { assessment: "sin_evidencia", nota: "No menciona AFP/ONP." },
  },
  "CV_Ramos_Brenda.pdf": {
    "p7-r1": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Administración en curso (8º ciclo)." },
    "p7-r2": { assessment: "no_cumplido", nota: "Dice 'no cuento con experiencia en planillas'." },
    "p7-r3": { assessment: "no_cumplido", nota: "Dice 'ni en PLAME'." },
    "p7-r4": { assessment: "sin_evidencia", nota: "Gestión de legajos, no legislación laboral (CTS...)." },
    "p7-r5": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Excel básico, por debajo de avanzado." },
    "p7-r6": { assessment: "sin_evidencia", nota: "No menciona AFP/ONP." },
  },
  "CV_Quiroz_Walter.pdf": {
    "p7-r1": { assessment: "sin_evidencia", nota: "Secundaria completa." },
    "p7-r2": { assessment: "sin_evidencia", nota: "Vendedor, no planillas." },
    "p7-r3": { assessment: "sin_evidencia", nota: "No PLAME/T-Registro." },
    "p7-r4": { assessment: "sin_evidencia", nota: "No legislación laboral." },
    "p7-r5": { assessment: "sin_evidencia", nota: "No menciona Excel." },
    "p7-r6": { assessment: "sin_evidencia", nota: "No AFP/ONP." },
  },

  // ───────────────────────── Puesto 8 · Residente de Obra (Ing. Civil) ─────────────────────────
  "CV_Zegarra_Hernan.pdf": {
    "p8-r1": { assessment: "acreditado", nota: "Título profesional de Ingeniero Civil." },
    "p8-r2": { assessment: "pendiente_verificacion", motivo: "legal", nota: "Declara colegiatura CIP vigente; verificar documento." },
    "p8-r3": { assessment: "acreditado", nota: "~9 años en ejecución de obra." },
    "p8-r4": { assessment: "acreditado", nota: "AutoCAD nivel avanzado." },
    "p8-r5": { assessment: "acreditado", nota: "S10 y MS Project." },
    "p8-r6": { assessment: "acreditado", nota: "Seguridad y salud en obra (Ley 29783)." },
  },
  "CV_Rios_Pedro.pdf": {
    "p8-r1": { assessment: "acreditado", nota: "Título profesional de Ingeniero Civil." },
    "p8-r2": { assessment: "pendiente_verificacion", motivo: "legal", nota: "Declara colegiatura CIP vigente; verificar documento." },
    "p8-r3": { assessment: "acreditado", nota: "~5-6 años en supervisión de obra." },
    "p8-r4": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "AutoCAD nivel intermedio, por debajo de avanzado." },
    "p8-r5": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Tiene S10 pero no MS Project." },
    "p8-r6": { assessment: "sin_evidencia", nota: "No menciona seguridad y salud en obra." },
  },
  "CV_Ayala_Sandra.pdf": {
    "p8-r1": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "Bachiller; título en trámite, no titulada." },
    "p8-r2": { assessment: "sin_evidencia", nota: "Bachiller: no declara colegiatura CIP." },
    "p8-r3": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "~4.5 años como asistente, por debajo de 5." },
    "p8-r4": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "AutoCAD nivel intermedio, por debajo de avanzado." },
    "p8-r5": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "S10 básico; no MS Project." },
    "p8-r6": { assessment: "sin_evidencia", nota: "No menciona seguridad en obra." },
  },
  "CV_Ninahuanca_Gregorio.pdf": {
    "p8-r1": { assessment: "sin_evidencia", nota: "Secundaria; maestro de obra, no ingeniero civil." },
    "p8-r2": { assessment: "sin_evidencia", nota: "No declara colegiatura." },
    "p8-r3": { assessment: "pendiente_verificacion", motivo: "parcial", nota: "15 años en obra pero como maestro, no residente/supervisor/ingeniero." },
    "p8-r4": { assessment: "sin_evidencia", nota: "Lectura básica de planos, no AutoCAD." },
    "p8-r5": { assessment: "sin_evidencia", nota: "No S10/MS Project." },
    "p8-r6": { assessment: "sin_evidencia", nota: "No menciona seguridad en obra." },
  },
};
