/**
 * Banco ADVERSARIO del motor de reglas: textos escritos a propósito para que
 * acredite de más. La mitad opuesta está en `legitimo.ts`; el motor común de
 * ejecución e impresión, en `banco.ts`.
 *
 * Uso: npm run medir:motor:adversario [-- --grupo A] [-- --verbose]
 */
import { exit } from "node:process";
import { correrBanco, type Caso } from "./banco";

const CASOS: Caso[] = [
  // ---------------------------------------------------------------- A. Formación
  {
    grupo: "A. Formación",
    nombre: "Colegiatura en trámite",
    texto: "Contabilidad: colegiatura en trámite, expediente presentado en octubre.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["pendiente_verificacion"],
    porque: "Una colegiatura EN TRÁMITE no prueba el título todavía; hay que verificarla.",
  },
  {
    grupo: "A. Formación",
    nombre: "El colegiado es el referente, no el candidato",
    texto: "Referencias personales: Juan Pérez Soto, Contador Público Colegiado, jefe directo en Comercial SAC.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contador"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Quien está colegiado es la persona de referencia, no el postulante.",
  },
  {
    grupo: "A. Formación",
    nombre: "Estudios truncos",
    texto: "Estudios truncos de Contabilidad en la Universidad Nacional Ficticia.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["pendiente_verificacion"],
    porque: "Unos estudios truncos no son un título.",
  },
  {
    grupo: "A. Formación",
    nombre: "PDF extraído sin saltos de línea",
    texto:
      "FORMACIÓN ACADÉMICA Bachiller en Administración de Empresas Universidad Ficticia 2016-2021 EXPERIENCIA Asistente de Contabilidad en Comercial SAC 2022-2026",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["pendiente_verificacion"],
    porque:
      "El título es en Administración; «Contabilidad» es el cargo. Al perderse los saltos de línea, todo cae en una sola oración.",
  },
  {
    grupo: "A. Formación",
    nombre: "«Colegio» es secundaria, no carrera",
    texto: "Egresado del colegio nacional Ficticio. Apoyo en el área de Contabilidad.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["pendiente_verificacion"],
    porque: "Haber egresado del colegio no acredita una carrera de Contabilidad.",
  },

  // ------------------------------------------------- B. Negaciones y terceros
  {
    grupo: "B. Negaciones y terceros",
    nombre: "Negación corta",
    texto: "No manejo SAP Business One.",
    requisito: { category: "herramienta", description: "Manejo de SAP Business One", keywords: ["SAP Business One"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Lo dice negado.",
  },
  {
    grupo: "B. Negaciones y terceros",
    nombre: "Negación a más de 3 palabras del término",
    texto: "No tengo ninguna experiencia práctica en SAP Business One.",
    requisito: { category: "herramienta", description: "Manejo de SAP Business One", keywords: ["SAP Business One"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Sigue siendo una negación, solo que más larga.",
  },
  {
    grupo: "B. Negaciones y terceros",
    nombre: "Lo hacía el equipo, no la persona",
    texto: "Mi equipo utilizaba Concar; yo apoyaba en el archivo físico.",
    requisito: { category: "herramienta", description: "Manejo de Concar", keywords: ["Concar"] },
    espera: ["pendiente_verificacion"],
    porque: "La herramienta la usaba el equipo; el candidato dice explícitamente que hacía otra cosa.",
  },
  {
    grupo: "B. Negaciones y terceros",
    nombre: "Lo usa la empresa, no la persona",
    texto: "La empresa utiliza SAP Business One en todas sus sedes del país.",
    requisito: { category: "herramienta", description: "Manejo de SAP Business One", keywords: ["SAP Business One"] },
    espera: ["pendiente_verificacion"],
    porque: "Describe a la empresa, no lo que sabe hacer el postulante.",
  },
  {
    grupo: "B. Negaciones y terceros",
    nombre: "Negación con «nulos»",
    texto: "Conocimientos nulos de Excel.",
    requisito: { category: "herramienta", description: "Manejo de Excel", keywords: ["Excel"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "«Nulos» niega el conocimiento igual que «sin».",
  },
  {
    grupo: "B. Negaciones y terceros",
    nombre: "Negación con «nunca»",
    texto: "Nunca he utilizado Concar.",
    requisito: { category: "herramienta", description: "Manejo de Concar", keywords: ["Concar"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Lo dice negado.",
  },

  // ----------------------------------------------------- C. Años y fechas
  {
    grupo: "C. Años y fechas",
    nombre: "La edad no es experiencia",
    texto: "Tengo 32 años. Asistente contable en Comercial SAC.",
    requisito: { category: "experiencia", description: "3 años en contabilidad", keywords: ["contable"], minYears: 3 },
    espera: ["pendiente_verificacion"],
    porque: "«32 años» es la edad, no años de experiencia.",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "La antigüedad de la empresa no es experiencia",
    texto: "Comercial SAC, empresa con 30 años en el mercado. Asistente de Contabilidad desde 2025.",
    requisito: { category: "experiencia", description: "5 años en contabilidad", keywords: ["Contabilidad"], minYears: 5 },
    espera: ["pendiente_verificacion"],
    porque: "Los 30 años son de la empresa; la persona lleva uno.",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "Empleos solapados en el tiempo",
    texto: [
      "Experiencia laboral",
      "Analista contable | Empresa Uno | 01/2020 - 12/2022",
      "Asistente contable | Empresa Dos | 06/2021 - 12/2023",
    ].join("\n"),
    requisito: { category: "experiencia", description: "5 años en contabilidad", keywords: ["contable"], minYears: 5 },
    espera: ["pendiente_verificacion"],
    porque:
      "Los dos empleos se solapan: del 01/2020 al 12/2023 hay 4 años reales, no 5,5. Sumarlos sería contar doble.",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "Fechas en el futuro",
    texto: ["Experiencia laboral", "Analista contable | Empresa Uno | 03/2027 - 12/2030"].join("\n"),
    requisito: { category: "experiencia", description: "2 años en contabilidad", keywords: ["contable"], minYears: 2 },
    espera: ["pendiente_verificacion"],
    porque: "Son fechas posteriores a la fecha de evaluación: esa experiencia no existe todavía.",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "Prácticas de 6 meses",
    texto: ["Experiencia laboral", "Prácticas preprofesionales en Contabilidad | 01/2024 - 06/2024"].join("\n"),
    requisito: { category: "experiencia", description: "3 años en contabilidad", keywords: ["Contabilidad"], minYears: 3 },
    espera: ["pendiente_verificacion"],
    porque: "Seis meses no son tres años.",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "Fechas invertidas",
    texto: ["Experiencia laboral", "Asistente contable | Empresa Uno | 12/2022 - 03/2019"].join("\n"),
    requisito: { category: "experiencia", description: "3 años en contabilidad", keywords: ["contable"], minYears: 3 },
    espera: ["pendiente_verificacion"],
    porque: "El periodo está al revés: es un dato dudoso que debe revisar una persona.",
  },

  // ---------------------------------------------------------- D. Niveles
  {
    grupo: "D. Niveles",
    nombre: "Nivel avanzado de OTRA herramienta en la misma oración",
    texto: "Herramientas: Excel (nivel básico) y Power BI avanzado.",
    requisito: { category: "herramienta", description: "Excel intermedio-avanzado", keywords: ["Excel"] },
    espera: ["pendiente_verificacion"],
    porque: "El «avanzado» es de Power BI. El Excel declarado es básico.",
  },
  {
    grupo: "D. Niveles",
    nombre: "Lo mismo, en dos oraciones",
    texto: "Excel nivel básico. Power BI avanzado.",
    requisito: { category: "herramienta", description: "Excel intermedio-avanzado", keywords: ["Excel"] },
    espera: ["pendiente_verificacion"],
    porque: "Igual que el anterior, pero con la puntuación que el motor necesita.",
  },
  {
    grupo: "D. Niveles",
    nombre: "Idioma básico junto a otro avanzado",
    texto: "Idiomas: inglés básico, francés avanzado.",
    requisito: { category: "idioma", description: "Inglés intermedio", keywords: ["inglés"] },
    espera: ["pendiente_verificacion"],
    porque: "El inglés es básico; el avanzado es el francés.",
  },

  // ------------------------------------------- E. Texto hostil de extracción
  {
    grupo: "E. Texto de extracción",
    nombre: "Letras espaciadas por el PDF",
    texto: "C O N T A B I L I D A D   G E N E R A L",
    requisito: { category: "experiencia", description: "Contabilidad general", keywords: ["contabilidad"] },
    espera: ["acreditado"],
    porque: "Es un título de sección que el PDF abrió letra por letra.",
  },
  {
    grupo: "E. Texto de extracción",
    nombre: "Palabra espaciada de tres letras",
    texto: "M A N E J O   D E   S A P",
    requisito: { category: "herramienta", description: "SAP", keywords: ["SAP"] },
    espera: ["acreditado"],
    porque: "La línea entera está espaciada; «SAP» se reconstruye con el resto.",
  },
  {
    grupo: "E. Texto de extracción",
    nombre: "Palabra cortada con guion de línea",
    texto: "Experiencia en contabi-\nlidad general y tributación peruana.",
    requisito: { category: "experiencia", description: "Contabilidad general", keywords: ["contabilidad"] },
    espera: ["acreditado"],
    porque: "Una persona lee «contabilidad» sin dudar; el corte lo pone el PDF.",
  },
  {
    grupo: "E. Texto de extracción",
    nombre: "Guion suave invisible dentro de la palabra",
    texto: "Experiencia en contabi­lidad general.",
    requisito: { category: "experiencia", description: "Contabilidad general", keywords: ["contabilidad"] },
    espera: ["acreditado"],
    porque: "El guion suave (U+00AD) no se ve, pero rompe la palabra.",
  },
  {
    grupo: "E. Texto de extracción",
    nombre: "Término con símbolos (C++)",
    texto: "Programación en C++ y Python para automatizaciones.",
    requisito: { category: "habilidad_tecnica", description: "Programación en C++", keywords: ["C++"] },
    espera: ["acreditado"],
    porque: "El término tiene caracteres que en una expresión regular significan otra cosa.",
  },
  {
    grupo: "E. Texto de extracción",
    nombre: "Mayúsculas con tildes",
    texto: "GESTIÓN DE RECLAMOS Y TRIBUTACIÓN MENSUAL",
    requisito: { category: "experiencia", description: "Tributación", keywords: ["tributación"] },
    espera: ["acreditado"],
    porque: "Debe encontrarlo pese a mayúsculas y tildes.",
  },

  // --------------------------------------------- F. Requisito mal configurado
  {
    grupo: "F. Requisito mal configurado",
    nombre: "Término de dos letras que aparece por casualidad",
    texto: "Si bien no manejo Excel, aprendo rápido.",
    requisito: { category: "habilidad_tecnica", description: "Sistemas de Información (SI)", keywords: ["SI"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "El «Si» encontrado es la conjunción, no la sigla. Un término tan corto no debería acreditar nada solo.",
  },
  {
    grupo: "F. Requisito mal configurado",
    nombre: "Término en blanco",
    texto: "Asistente de Contabilidad con 4 años de experiencia.",
    requisito: { category: "habilidad_tecnica", description: "Requisito sin términos", keywords: ["   "] },
    espera: ["pendiente_verificacion"],
    porque: "Un término vacío debe dejar el requisito sin evaluar, no reventar.",
  },

  // ----------------------------------------------------------- G. Robustez
  {
    grupo: "G. Robustez",
    nombre: "Oración con decenas de miles de separadores",
    texto: `Herramientas: ${"Excel, ".repeat(20000)}y Concar avanzado.`,
    // La descripción pide nivel a propósito: así se recorre el ítem de la
    // enumeración, que es donde una oración con 40.000 separadores podría
    // reventar si se acumularan en un arreglo.
    requisito: { category: "herramienta", description: "Concar intermedio-avanzado", keywords: ["Concar"] },
    espera: ["acreditado"],
    porque: "Un CV degenerado no debe hacer reventar el motor ni dejarlo colgado.",
  },
  {
    grupo: "G. Robustez",
    nombre: "Requisito con muchos términos",
    texto: "Manejo de Concar y SAP para el cierre contable mensual.",
    requisito: {
      category: "herramienta",
      description: "Herramientas contables",
      keywords: Array.from({ length: 120 }, (_, i) => `herramienta${i}`).concat(["Concar"]),
    },
    espera: ["acreditado"],
    porque: "120 términos configurados no deben degradar ni cambiar el resultado.",
  },
  {
    grupo: "G. Robustez",
    nombre: "Emojis y caracteres raros alrededor del término",
    texto: "✅ Manejo de Concar 💼 — cierre contable ✨",
    requisito: { category: "herramienta", description: "Manejo de Concar", keywords: ["Concar"] },
    espera: ["acreditado"],
    porque: "Los CVs de plantilla vienen llenos de iconos.",
  },
  {
    grupo: "G. Robustez",
    nombre: "Término repetido cien veces",
    texto: `Perfil: ${"Concar. ".repeat(100)}`,
    requisito: { category: "herramienta", description: "Manejo de Concar", keywords: ["Concar"] },
    espera: ["acreditado"],
    porque: "El relleno de palabras clave no debe romper nada (el tope de coincidencias es interno).",
  },

  // ------------------------------------------- H. Grado académico (Perú)
  {
    grupo: "H. Grado académico",
    nombre: "Egresado para un puesto que pide título",
    texto: "Egresado de la carrera de Contabilidad, Universidad Nacional Ficticia, 2021.",
    requisito: { category: "formacion", description: "Título profesional en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["pendiente_verificacion"],
    porque: "En el Perú egresar no da el bachillerato ni el título: son grados legalmente distintos.",
  },
  {
    grupo: "H. Grado académico",
    nombre: "Bachiller para un puesto que pide título",
    texto: "Bachiller en Contabilidad, Universidad Nacional Ficticia, 2021.",
    requisito: { category: "formacion", description: "Título profesional en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["pendiente_verificacion"],
    porque: "El bachillerato tampoco es el título profesional.",
  },
  {
    grupo: "H. Grado académico",
    nombre: "Secundaria para un puesto que pide estudios superiores",
    texto: "Secundaria completa, Colegio Nacional Ficticio. Estudios de computación básica.",
    requisito: { category: "formacion", description: "Estudios técnicos o universitarios", keywords: ["estudios"] },
    espera: ["pendiente_verificacion"],
    porque: "En el Perú «colegio» es secundaria, no educación superior.",
  },
  {
    grupo: "H. Grado académico",
    nombre: "Cargo con la palabra «técnico» no es un grado",
    texto: "Asistente técnico contable en Comercial Ficticia SAC.",
    requisito: { category: "formacion", description: "Título profesional en Contabilidad", keywords: ["contable"] },
    espera: ["pendiente_verificacion"],
    porque: "«Técnico» aquí es parte del cargo; no demuestra ningún grado académico.",
  },

  // ------------------------------------------- H2. Nivel de idioma por código
  {
    grupo: "H. Grado académico",
    nombre: "Inglés A2 para un puesto que pide B2",
    texto: "Idiomas: Español nativo, Inglés A2.",
    requisito: { category: "idioma", description: "Inglés intermedio (B2)", keywords: ["Inglés"] },
    espera: ["pendiente_verificacion"],
    porque: "A2 es elemental: es lo contrario de intermedio, aunque el CV no escriba la palabra «básico».",
  },
  {
    grupo: "H. Grado académico",
    nombre: "Inglés A1 para un puesto que pide B2",
    texto: "Idiomas: Inglés A1 (en proceso de mejora).",
    requisito: { category: "idioma", description: "Inglés B2", keywords: ["Inglés"] },
    espera: ["pendiente_verificacion"],
    porque: "A1 es el nivel más bajo del marco europeo.",
  },

  // ------------------------------------------- I. Alcance de la negación y del contexto
  {
    grupo: "I. Negación y contexto",
    nombre: "«No cuento con experiencia en…»",
    texto: "No cuento con experiencia en Concar, pero sí en SAP Business One.",
    requisito: { category: "herramienta", description: "Concar", keywords: ["Concar"] },
    espera: ["pendiente_verificacion"],
    porque: "Lo niega explícitamente, con cuatro palabras entre la negación y el término.",
  },
  {
    grupo: "I. Negación y contexto",
    nombre: "Negación partida por el margen del PDF",
    texto: [
      "Asistente administrativa con 3 años de experiencia en soporte de oficina y atención al personal. No cuento",
      "con experiencia en planillas ni en PLAME, pero sí en el manejo de legajos del personal.",
    ].join("\n"),
    requisito: { category: "experiencia", description: "Experiencia en planillas", keywords: ["planillas"] },
    espera: ["pendiente_verificacion"],
    porque: "El PDF partió la frase por el ancho de la hoja; la negación es de esta misma frase.",
  },
  {
    grupo: "I. Negación y contexto",
    nombre: "Término dentro de un correo",
    texto: "Luis Ficticio. Teléfono 999888777. Correo: sap@miempresa.com",
    requisito: { category: "herramienta", description: "SAP", keywords: ["SAP"] },
    espera: ["pendiente_verificacion"],
    porque: "Es parte de una dirección de correo, no una herramienta que maneje.",
  },
  {
    grupo: "I. Negación y contexto",
    nombre: "Término dentro de un enlace",
    texto: "Perfil y certificados: https://www.concar.com.pe/mi-perfil",
    requisito: { category: "herramienta", description: "Concar", keywords: ["Concar"] },
    espera: ["pendiente_verificacion"],
    porque: "Un enlace no demuestra manejo del software.",
  },
  {
    grupo: "I. Negación y contexto",
    nombre: "Curso que piensa tomar",
    texto: "Intereses personales: lectura, ajedrez y cursos de Concar que planeo tomar.",
    requisito: { category: "herramienta", description: "Concar", keywords: ["Concar"] },
    espera: ["pendiente_verificacion"],
    porque: "Es una intención futura, no experiencia.",
  },
  // --------------------------------------------------- J. Equivalencias
  {
    grupo: "J. Equivalencias",
    nombre: "Libros contables llevados por su equipo",
    texto: "Jefe de oficina. Mi equipo llevaba los libros contables de la empresa mientras yo coordinaba compras.",
    requisito: { category: "habilidad_tecnica", description: "Contabilidad", keywords: ["contabilidad"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "El sinónimo lo hacía un tercero (su equipo), no el candidato.",
  },
  {
    grupo: "J. Equivalencias",
    nombre: "Atención al público negada",
    texto: "Auxiliar de almacén. No tengo experiencia en atención al público; siempre trabajé en bodega.",
    requisito: { category: "habilidad_tecnica", description: "Atención al cliente", keywords: ["atención al cliente"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Niega el sinónimo; la equivalencia no debe saltarse la negación.",
  },
  {
    grupo: "J. Equivalencias",
    nombre: "Empresa comercial no es ventas",
    texto: "Analista de sistemas en una empresa comercial. Mantenimiento de servidores y soporte a usuarios.",
    requisito: { category: "experiencia", description: "Ventas", keywords: ["ventas"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "«Comercial» describe a la empresa, no que el candidato venda; la equivalencia ventas/comercial infla.",
  },
  {
    grupo: "J. Equivalencias",
    nombre: "Área comercial como lugar de trabajo",
    texto: "Asistente administrativo del área comercial: archivo de contratos y control de asistencia.",
    requisito: { category: "experiencia", description: "Ventas", keywords: ["ventas"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Trabajar en el área comercial en tareas administrativas no es haber vendido.",
  },
  {
    grupo: "J. Equivalencias",
    nombre: "Curso de contabilidad por tomar con sinónimo",
    texto: "Intereses personales: lectura y cursos de registros contables que planeo tomar.",
    requisito: { category: "habilidad_tecnica", description: "Contabilidad", keywords: ["contabilidad"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Intención futura expresada con el sinónimo, no experiencia.",
  },
  // ------------------------------------------------ K. Puntos ciegos (reglas-v11)
  {
    grupo: "K. Puntos ciegos",
    nombre: "El término es el nombre de la empresa",
    texto: "EXPERIENCIA\nRecepcionista - SAP Perú S.A.C. (2020 - 2023)\nAtención de visitas.",
    requisito: { category: "herramienta", description: "Manejo de SAP", keywords: ["SAP"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Trabajar en una empresa llamada SAP no dice que la persona maneje SAP.",
  },
  {
    grupo: "K. Puntos ciegos",
    nombre: "Años de otra área junto al término",
    texto: "10 años de experiencia en ventas y conocimientos de contabilidad básica.",
    requisito: { category: "experiencia", description: "Mínimo 3 años de experiencia en contabilidad", keywords: ["contabilidad"], minYears: 3 },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Los 10 años son de ventas; de contabilidad solo declara conocimientos básicos.",
  },
  {
    grupo: "K. Puntos ciegos",
    nombre: "La herramienta solo aparece en un curso",
    texto: "CURSOS\nCurso de SAP FI - Instituto Ficticio (2024)",
    requisito: { category: "herramienta", description: "Manejo de SAP", keywords: ["SAP"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Haber llevado un curso no muestra que la haya usado en el trabajo.",
  },
  {
    grupo: "K. Puntos ciegos",
    nombre: "Intención futura",
    texto: "Próximamente me certificaré en SAP.",
    requisito: { category: "herramienta", description: "Manejo de SAP", keywords: ["SAP"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Lo que hará en el futuro todavía no es experiencia.",
  },
  {
    grupo: "K. Puntos ciegos",
    nombre: "«Me interesa…»",
    texto: "Me interesa mucho trabajar con SAP.",
    requisito: { category: "herramienta", description: "Manejo de SAP", keywords: ["SAP"] },
    espera: ["pendiente_verificacion", "sin_evidencia"],
    porque: "Un interés no es experiencia.",
  },
  {
    grupo: "K. Puntos ciegos",
    nombre: "Una falta de ortografía no acredita",
    texto: "Manejo de Exel avanzado y Word.",
    requisito: { category: "herramienta", description: "Excel avanzado", keywords: ["Excel"] },
    espera: ["pendiente_verificacion"],
    porque: "«Exel» parece Excel, pero puede ser otra cosa: se señala para revisar, sin acreditar.",
  },
];

exit(
  correrBanco(
    "Banco adversario del motor",
    "Si el motor ACREDITA donde no debía, está inflando a quien no lo demuestra.",
    CASOS,
    "npm run medir:motor:adversario",
  ) > 0
    ? 1
    : 0,
);
