/**
 * Banco LEGÍTIMO del motor de reglas: la mitad que faltaba del instrumento.
 *
 * Cada caso es un texto que SÍ demuestra el requisito, escrito como lo escribe
 * la gente. Si el motor no lo acredita, está enterrando a un candidato que
 * cumple, y eso en esta plataforma es el error caro: no se ve.
 *
 * Está cargado a propósito hacia las reglas más desconfiadas de reglas-v4 —la
 * ventana de proximidad de la formación, el ítem de la enumeración para el
 * nivel, el enmascarado de referencias y los términos cortos—, porque son las
 * que podrían castigar de más. Un banco que solo mide falsos positivos haría
 * parecer una mejora a cualquier regla más estricta.
 *
 * Uso: npm run medir:motor:legitimo [-- --grupo A] [-- --verbose]
 */
import { exit } from "node:process";
import { correrBanco, type Caso } from "./banco";

const CASOS: Caso[] = [
  // --------------------------------------------------- A. Formación acreditada
  {
    grupo: "A. Formación",
    nombre: "Bachiller con universidad y año",
    texto: "Bachiller en Contabilidad — Universidad Ficticia del Perú (2021).",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "Es la forma más común de declarar un bachillerato.",
  },
  {
    grupo: "A. Formación",
    nombre: "Universidad primero, carrera después",
    texto: "Universidad Nacional Ficticia | Contabilidad | 2016 - 2021",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "La pista («universidad») va delante del término, separada por una barra.",
  },
  {
    grupo: "A. Formación",
    nombre: "Título profesional",
    texto: "Título profesional de Contador Público, otorgado en 2022.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contador"] },
    espera: ["acreditado"],
    porque: "Un título profesional acredita sin discusión.",
  },
  {
    grupo: "A. Formación",
    nombre: "Egresada de instituto",
    texto: "Egresada de la carrera de Contabilidad, Instituto Ficticio Superior.",
    requisito: { category: "formacion", description: "Estudios técnicos en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "Egresar de la carrera son estudios concluidos.",
  },
  {
    grupo: "A. Formación",
    nombre: "Colegiatura con número",
    texto: "Contadora Pública Colegiada (CPC N.º 12345), hábil.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contador"] },
    espera: ["acreditado"],
    porque: "Estar colegiada exige la carrera concluida.",
  },
  {
    grupo: "A. Formación",
    nombre: "Licenciatura",
    texto: "Licenciada en Administración de Empresas, Universidad Ficticia.",
    requisito: { category: "formacion", description: "Título en Administración", keywords: ["Administración"] },
    espera: ["acreditado"],
    porque: "Una licenciatura es un título.",
  },
  {
    grupo: "A. Formación",
    nombre: "Maestría (más que lo pedido)",
    texto: "Maestría en Finanzas Corporativas, Universidad Ficticia, 2024.",
    requisito: { category: "formacion", description: "Título universitario en Finanzas", keywords: ["Finanzas"] },
    espera: ["acreditado"],
    porque: "Quien tiene maestría tiene título: no puede quedar por debajo de un bachiller.",
  },
  {
    grupo: "A. Formación",
    nombre: "Línea larga pero con la pista al lado",
    texto:
      "FORMACIÓN ACADÉMICA\nUniversidad Nacional Mayor Ficticia, Facultad de Ciencias Contables, Bachiller en Contabilidad, 2021.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "La línea es larga, pero «Bachiller en» va pegado al término: la ventana de proximidad no debe estorbar.",
  },
  {
    grupo: "A. Formación",
    nombre: "Años delante de la universidad",
    texto: "2016 - 2021 · Universidad Ficticia del Perú — Contabilidad y Finanzas",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "Formato de línea de tiempo, muy habitual en CVs de plantilla.",
  },

  {
    grupo: "A. Formación",
    nombre: "Diplomado (decisión de la empresa: cuenta)",
    texto: "Diplomado en Contabilidad Gerencial (40 horas) - Instituto Ficticio.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque:
      "DECISIÓN DE NEGOCIO (05/11/2026): la empresa acepta un diplomado como evidencia de formación. El motor lo acredita y el reclutador ve la cita literal para decidir. Si algún día se quiere distinguir el grado académico de la formación continua, este es el caso que debe cambiar.",
  },

  // ------------------------------------------------- B. El candidato es el actor
  {
    grupo: "B. El candidato actúa",
    nombre: "Implementé X en la empresa",
    texto: "Implementé SAP Business One en la empresa, liderando la migración de datos.",
    requisito: { category: "herramienta", description: "Manejo de SAP Business One", keywords: ["SAP Business One"] },
    espera: ["acreditado"],
    porque: "Aparece «la empresa», pero quien lo hizo es el candidato. Una regla de atribución ingenua lo rechazaría.",
  },
  {
    grupo: "B. El candidato actúa",
    nombre: "Capacité al equipo en X",
    texto: "Capacité al equipo contable en el uso de Concar durante el cierre anual.",
    requisito: { category: "herramienta", description: "Manejo de Concar", keywords: ["Concar"] },
    espera: ["acreditado"],
    porque: "Aparece «al equipo»: quien enseña la herramienta la domina.",
  },
  {
    grupo: "B. El candidato actúa",
    nombre: "Lideré el área",
    texto: "Lideré el área contable de la empresa durante tres años.",
    requisito: { category: "experiencia", description: "Experiencia en contabilidad", keywords: ["contable"] },
    espera: ["acreditado"],
    porque: "Aparecen «el área» y «la empresa», y el sujeto sigue siendo el candidato.",
  },
  {
    grupo: "B. El candidato actúa",
    nombre: "Responsable de la migración en mi equipo",
    texto: "Responsable de la migración a Concar en mi equipo de trabajo.",
    requisito: { category: "herramienta", description: "Manejo de Concar", keywords: ["Concar"] },
    espera: ["acreditado"],
    porque: "«Mi equipo» aparece, pero el responsable es quien firma el CV.",
  },
  {
    grupo: "B. El candidato actúa",
    nombre: "Logro con la herramienta",
    texto: "Reduje en 30% los errores de reporte del equipo usando Excel avanzado.",
    requisito: { category: "herramienta", description: "Excel intermedio-avanzado", keywords: ["Excel"] },
    espera: ["acreditado"],
    porque: "Un logro cuantificado con la herramienta es la mejor evidencia posible.",
  },

  // --------------------------------------------------------- C. Años y fechas
  {
    grupo: "C. Años y fechas",
    nombre: "Años declarados con «más de»",
    texto: "Contadora con más de 5 años de experiencia en contabilidad general.",
    requisito: { category: "experiencia", description: "3 años en contabilidad", keywords: ["contabilidad"], minYears: 3 },
    espera: ["acreditado"],
    porque: "Lo declara y supera el mínimo.",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "Un empleo con fechas completas",
    texto: ["Experiencia laboral", "Analista contable | Empresa Uno | 03/2019 - 12/2022"].join("\n"),
    requisito: { category: "experiencia", description: "3 años en contabilidad", keywords: ["contable"], minYears: 3 },
    espera: ["acreditado"],
    porque: "Del 03/2019 al 12/2022 hay casi 4 años.",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "Empleo en curso",
    texto: ["Experiencia laboral", "Asistente contable | Empresa Uno | 01/2021 - a la actualidad"].join("\n"),
    requisito: { category: "experiencia", description: "2 años en contabilidad", keywords: ["contable"], minYears: 2 },
    espera: ["acreditado"],
    porque: "Lleva casi 6 años en el puesto.",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "Años escritos con letras",
    texto: "Contadora con experiencia de más de cuatro años en tributación peruana.",
    requisito: { category: "experiencia", description: "3 años en tributación", keywords: ["tributación"], minYears: 3 },
    espera: ["acreditado"],
    porque: "«Cuatro años» es tan explícito como «4 años».",
  },
  {
    grupo: "C. Años y fechas",
    nombre: "Dos empleos consecutivos que suman",
    texto: [
      "Experiencia laboral",
      "Asistente contable | Empresa Uno | 01/2018 - 12/2019",
      "Analista contable | Empresa Dos | 01/2020 - 12/2022",
    ].join("\n"),
    requisito: { category: "experiencia", description: "4 años en contabilidad", keywords: ["contable"], minYears: 4 },
    espera: ["acreditado"],
    porque: "No se solapan: 2 + 3 son 5 años reales.",
  },

  // ------------------------------------------------------------- D. Niveles
  {
    grupo: "D. Niveles",
    nombre: "Nivel avanzado del propio término",
    texto: "Herramientas: Excel avanzado, Power BI intermedio.",
    requisito: { category: "herramienta", description: "Excel intermedio-avanzado", keywords: ["Excel"] },
    espera: ["acreditado"],
    porque: "El «avanzado» es del Excel, en su mismo ítem.",
  },
  {
    grupo: "D. Niveles",
    nombre: "Idioma avanzado con otro básico al lado",
    texto: "Idiomas: inglés avanzado (C1), portugués básico.",
    requisito: { category: "idioma", description: "Inglés intermedio", keywords: ["inglés"] },
    espera: ["acreditado"],
    porque: "El básico es del portugués; el inglés supera lo pedido.",
  },
  {
    grupo: "D. Niveles",
    nombre: "Nivel declarado antes del término",
    texto: "Manejo intermedio de Excel para reportes gerenciales.",
    requisito: { category: "herramienta", description: "Excel intermedio-avanzado", keywords: ["Excel"] },
    espera: ["acreditado"],
    porque: "La palabra de nivel va delante del término.",
  },
  {
    grupo: "D. Niveles",
    nombre: "Nivel tras dos puntos",
    texto: "Excel: nivel avanzado, con tablas dinámicas y macros.",
    requisito: { category: "herramienta", description: "Excel intermedio-avanzado", keywords: ["Excel"] },
    espera: ["acreditado"],
    porque: "Los dos puntos no deben cortar el ítem.",
  },

  // ------------------------------------------- E. Términos cortos y variantes
  {
    grupo: "E. Términos y variantes",
    nombre: "Término corto legítimo (B2)",
    texto: "Idiomas: inglés B2 certificado por instituto.",
    requisito: { category: "idioma", description: "Inglés intermedio-alto (nivel B2)", keywords: ["B2"] },
    espera: ["acreditado"],
    porque: "Es el caso que existe en las vacantes reales del proyecto.",
  },
  {
    grupo: "E. Términos y variantes",
    nombre: "Sigla de dos letras (TI)",
    texto: "Soporte de TI y redes en planta industrial.",
    requisito: { description: "Soporte de TI", keywords: ["TI"] },
    espera: ["acreditado"],
    porque: "Escrita como sigla, debe encontrarse.",
  },
  {
    grupo: "E. Términos y variantes",
    nombre: "Plural por singular",
    texto: "Elaboración de comprobantes electrónicos y notas de crédito.",
    requisito: { description: "Emisión de comprobantes", keywords: ["comprobante"] },
    espera: ["acreditado"],
    porque: "El motor busca variantes de número.",
  },
  {
    grupo: "E. Términos y variantes",
    nombre: "Plural en el término, singular en el CV",
    texto: "Conciliación bancaria mensual de seis cuentas.",
    requisito: { description: "Conciliaciones bancarias", keywords: ["conciliaciones bancarias"] },
    espera: ["acreditado"],
    porque: "La variante debe funcionar en los dos sentidos.",
  },
  {
    grupo: "E. Términos y variantes",
    nombre: "Femenino por masculino",
    texto: "Contadora general con manejo de cierres mensuales.",
    requisito: { description: "Contador general", keywords: ["contador"] },
    espera: ["acreditado"],
    porque: "«Contadora» es la misma palabra.",
  },

  // ---------------------------------------------- F. Referencias y secciones
  {
    grupo: "F. Referencias",
    nombre: "El CV completo, con referencias al final",
    texto: [
      "Carmen Ficticia Quispe",
      "Contadora Pública Colegiada | Asistente Contable",
      "FORMACIÓN",
      "Bachiller en Contabilidad, Universidad Ficticia, 2019.",
      "REFERENCIAS",
      "Juan Pérez Soto, Gerente de Finanzas, Comercial SAC.",
    ].join("\n"),
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "El enmascarado de referencias no debe comerse la formación del candidato, que está antes.",
  },
  {
    grupo: "F. Referencias",
    nombre: "Sección del candidato después de las referencias",
    texto: [
      "Ana Ficticia Salas",
      "Referencias: Juan Pérez Soto, Gerente de Finanzas.",
      "Formación académica",
      "Contadora Pública titulada, Universidad Ficticia, 2020.",
    ].join("\n"),
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contador"] },
    espera: ["acreditado"],
    porque: "Si tras las referencias vuelve una sección del candidato, el enmascarado tiene que cerrarse ahí.",
  },
  {
    grupo: "F. Referencias",
    nombre: "«Referencias disponibles a solicitud»",
    texto: [
      "Luis Ficticio Mendoza",
      "Bachiller en Contabilidad, Universidad Ficticia, 2020.",
      "Referencias disponibles a solicitud.",
    ].join("\n"),
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "La frase de cortesía no debe ocultar nada que importe.",
  },

  // ------------------------------------------- G. El precio de la escalera de grados
  {
    grupo: "G. Grado académico",
    nombre: "Título cuando el puesto pide bachiller",
    texto: "Título profesional en Contabilidad, Universidad Ficticia del Perú, 2022.",
    requisito: { category: "formacion", description: "Bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "El grado mayor cubre al menor: quien tiene título tiene el bachillerato.",
  },
  {
    grupo: "G. Grado académico",
    nombre: "Técnico cuando el puesto pide técnico",
    texto: "Técnico en Contabilidad, Instituto Ficticio Superior, 2019.",
    requisito: { category: "formacion", description: "Estudios técnicos en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque: "Es exactamente el grado que pide la vacante.",
  },
  {
    grupo: "G. Grado académico",
    nombre: "Colegio PROFESIONAL, no secundaria",
    texto: "Contadora Pública Colegiada, miembro del Colegio de Contadores Públicos de Lima.",
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contador"] },
    espera: ["acreditado"],
    porque: "«Colegio de Contadores» significa lo contrario que «colegio»: exige la carrera concluida.",
  },
  {
    grupo: "G. Grado académico",
    nombre: "«Colegio de» partido por una columna estrecha",
    texto: [
      "Contabilidad en la Universidad Nacional Ficticia, hoy miembro del Colegio de",
      "Contadores Públicos de Lima.",
    ].join("\n"),
    requisito: { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] },
    espera: ["acreditado"],
    porque:
      "En una plantilla a dos columnas el PDF corta tras «de». Si esa línea valiera como «colegio» de secundaria, la escalera de grados bloquearía a un profesional colegiado.",
  },
  {
    grupo: "G. Grado académico",
    nombre: "Egresado cuando la vacante no exige un grado",
    texto: "Egresado de la carrera de Contabilidad, Universidad Nacional Ficticia, 2021.",
    requisito: {
      category: "formacion",
      description: "Estudios universitarios en Contabilidad",
      keywords: ["Contabilidad"],
    },
    espera: ["acreditado"],
    porque: "La vacante no nombra ningún grado, así que la escalera no debe intervenir.",
  },

  // ------------------------------------------- G2. El precio del nivel por código
  {
    grupo: "G. Grado académico",
    nombre: "Inglés B2 escrito solo con el código",
    texto: "Idiomas: Español nativo, Inglés B2.",
    requisito: { category: "idioma", description: "Inglés intermedio (B2)", keywords: ["Inglés"] },
    espera: ["acreditado"],
    porque: "Es exactamente el nivel que pide la vacante, escrito como lo escribe todo el mundo.",
  },
  {
    grupo: "G. Grado académico",
    nombre: "Inglés C1 (más que lo pedido)",
    texto: "Idiomas: Inglés C1, certificado.",
    requisito: { category: "idioma", description: "Inglés intermedio (B2)", keywords: ["Inglés"] },
    espera: ["acreditado"],
    porque: "C1 está por encima de B2: un nivel mayor no puede quedar por debajo.",
  },
  {
    grupo: "G. Grado académico",
    nombre: "Idioma sin nivel declarado",
    texto: "Idiomas: Inglés y portugués.",
    requisito: { category: "idioma", description: "Inglés intermedio (B2)", keywords: ["Inglés"] },
    espera: ["acreditado"],
    porque: "No declarar el nivel no es declararlo bajo; el reclutador lo verifica con la cita delante.",
  },
  {
    grupo: "G. Grado académico",
    nombre: "«B2B» de ventas no es un nivel de idioma",
    texto: "Experiencia en ventas B2B y cuentas clave, nivel avanzado.",
    requisito: { category: "experiencia", description: "Ventas B2B nivel avanzado", keywords: ["B2B"] },
    espera: ["acreditado"],
    porque: "La regla del marco europeo solo se aplica a requisitos de idioma: «B2B» no debe tocarse.",
  },

  // ------------------------------------------- H. El precio de la negación y del filtro de enlaces
  {
    grupo: "H. Negación y enlaces",
    nombre: "«No» de otra proposición",
    texto: "No es un problema el cierre contable a presión, manejo Concar a diario.",
    requisito: { category: "herramienta", description: "Concar", keywords: ["Concar"] },
    espera: ["acreditado"],
    porque: "La negación es de la proposición anterior; la coma la cierra.",
  },
  {
    grupo: "H. Negación y enlaces",
    nombre: "Entrada nueva tras una línea negativa",
    texto: ["No manejo sistemas contables de terceros.", "Concar a nivel avanzado desde 2019, uso diario."].join("\n"),
    requisito: { category: "herramienta", description: "Concar", keywords: ["Concar"] },
    espera: ["acreditado"],
    porque: "La línea siguiente abre en mayúscula: es otra entrada y la negación no debe arrastrarse.",
  },
  {
    grupo: "H. Negación y enlaces",
    nombre: "Frase partida por el margen que SÍ afirma",
    texto: [
      "Contadora con 6 años de experiencia en cierres mensuales. Manejo diario de Concar y",
      "conciliaciones bancarias de cinco cuentas en empresas comerciales.",
    ].join("\n"),
    requisito: { category: "herramienta", description: "Concar", keywords: ["conciliaciones"] },
    espera: ["acreditado"],
    porque: "Unir las dos líneas no debe inventar una negación donde no hay ninguna.",
  },
  {
    grupo: "H. Negación y enlaces",
    nombre: "Deseo de mejorar algo que ya usa",
    texto: "Manejo Excel avanzado, que quiero perfeccionar con un curso de macros.",
    requisito: { category: "herramienta", description: "Excel avanzado", keywords: ["Excel"] },
    espera: ["acreditado"],
    porque: "«Perfeccionar» supone que ya lo usa; solo los verbos de adquirir indican intención.",
  },
  {
    grupo: "H. Negación y enlaces",
    nombre: "Correo en los datos y el término aparte",
    texto: "Correo: luis@miempresa.com | Celular 999888777\nHerramientas: Concar, Excel y SAP.",
    requisito: { category: "herramienta", description: "Concar", keywords: ["Concar"] },
    espera: ["acreditado"],
    porque: "El filtro de enlaces debe alcanzar solo al token del correo, no al resto del CV.",
  },
  {
    grupo: "H. Negación y enlaces",
    nombre: "Punto final pegado al término",
    texto: "Herramientas contables: Concar, Excel y SAP.",
    requisito: { category: "herramienta", description: "SAP", keywords: ["SAP"] },
    espera: ["acreditado"],
    porque: "«SAP.» con el punto de cierre no es un dominio.",
  },
  // --------------------------------------------------- I. Equivalencias
  {
    grupo: "I. Equivalencias",
    nombre: "Libros contables por contabilidad",
    texto: "Responsable de los libros contables de la empresa y de su cierre mensual, con 4 años de experiencia.",
    requisito: { category: "habilidad_tecnica", description: "Contabilidad", keywords: ["contabilidad"] },
    espera: ["acreditado"],
    porque: "Llevar los libros contables es hacer contabilidad; el candidato no escribió la palabra literal.",
  },
  {
    grupo: "I. Equivalencias",
    nombre: "Atención al público por atención al cliente",
    texto: "Cajera con 3 años de experiencia. Atención al público en ventanilla y resolución de reclamos presenciales.",
    requisito: { category: "habilidad_tecnica", description: "Atención al cliente", keywords: ["atención al cliente"] },
    espera: ["acreditado"],
    porque: "Atender al público en ventanilla es atención al cliente dicha de otra forma.",
  },
  {
    grupo: "I. Equivalencias",
    nombre: "Servicio al cliente por atención al cliente",
    texto: "Brindé servicio al cliente en tienda durante dos años, con manejo de quejas y devoluciones.",
    requisito: { category: "habilidad_tecnica", description: "Atención al cliente", keywords: ["atención al cliente"] },
    espera: ["acreditado"],
    porque: "«Servicio al cliente» y «atención al cliente» son la misma función.",
  },
  {
    grupo: "I. Equivalencias",
    nombre: "Registros contables por contabilidad",
    texto: "Elaboré los registros contables mensuales y las conciliaciones de la empresa.",
    requisito: { category: "habilidad_tecnica", description: "Contabilidad", keywords: ["contabilidad"] },
    espera: ["acreditado"],
    porque: "Elaborar registros contables es una tarea de contabilidad.",
  },
  {
    grupo: "I. Equivalencias",
    nombre: "Tecnologías de la información por TI",
    texto: "Soporte técnico en el área de tecnologías de la información de la empresa durante tres años.",
    requisito: { category: "habilidad_tecnica", description: "Experiencia en TI", keywords: ["TI"] },
    espera: ["acreditado"],
    porque: "«Tecnologías de la información» es el nombre completo de TI.",
  },
];

exit(correrBanco("Banco legítimo del motor", "Si el motor NO acredita, está castigando a quien cumple.", CASOS, "npm run medir:motor:legitimo") > 0 ? 1 : 0);
