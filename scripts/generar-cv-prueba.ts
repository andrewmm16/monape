/**
 * Genera CVs FICTICIOS en PDF (texto seleccionable) para pruebas manuales.
 * Uso (desde la raíz): npx tsx scripts/generar-cv-prueba.ts
 * Es re-ejecutable: sobrescribe los PDFs en cv-prueba/<puesto>/.
 * Todos los datos son inventados (correos @example.com, teléfonos 999 000 0NN).
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

type Exp = { cargo: string; empresa: string; periodo: string; logros: string[] };
type Cv = {
  nombre: string;
  apellido: string;
  titular: string;
  ciudad: string;
  resumen: string;
  exp: Exp[];
  formacion: string[];
  habilidades: string[];
  idiomas: string[];
};
type Puesto = { carpeta: string; cvs: Cv[] };

const PUESTOS: Puesto[] = [
  {
    carpeta: "01_Asistente_Contable",
    cvs: [
      {
        nombre: "Carmen Rosa", apellido: "Quispe Huamani", titular: "Contadora Pública Colegiada | Asistente Contable", ciudad: "Lima, Perú",
        resumen: "Contadora pública colegiada con 6 años de experiencia en contabilidad general, tributación peruana y cierres mensuales. Manejo avanzado de SIRE, PLE y declaración mensual PDT 621 en empresas comerciales e industriales.",
        exp: [
          { cargo: "Asistente Contable Senior", empresa: "Distribuidora Andina Norte S.A.C. (ficticia)", periodo: "Mar 2021 - Actualidad", logros: ["Elaboré y presenté la declaración mensual de IGV y renta con 0 observaciones de SUNAT en 3 años.", "Redujé el tiempo de cierre contable de 10 a 6 días hábiles mediante conciliaciones semanales.", "Registré y concilié más de 800 comprobantes mensuales en SAP Business One."] },
          { cargo: "Asistente Contable", empresa: "Servicios Integrales Pampa E.I.R.L. (ficticia)", periodo: "Ene 2019 - Feb 2021", logros: ["Llevé libros electrónicos (PLE) y conciliaciones bancarias de 5 cuentas.", "Apoyé en la elaboración de estados financieros y planilla electrónica PLAME."] },
        ],
        formacion: ["Contabilidad - Universidad Nacional Ficticia del Centro (2014 - 2018), Título profesional", "Colegiada en el Colegio de Contadores Públicos de Lima (matrícula ficticia)", "Diplomado en Tributación Empresarial - Instituto Ficticio de Finanzas (2020)"],
        habilidades: ["NIIF y contabilidad general", "Tributación peruana (IGV, renta, detracciones)", "SAP Business One y Concar", "Excel avanzado (tablas dinámicas, BUSCARV)", "Conciliaciones bancarias", "Planilla electrónica PLAME"],
        idiomas: ["Español nativo", "Inglés intermedio (B1)"],
      },
      {
        nombre: "Luis Alberto", apellido: "Mendoza Rojas", titular: "Bachiller en Contabilidad | Asistente Contable", ciudad: "Callao, Perú",
        resumen: "Bachiller en Contabilidad con 3 años de experiencia en registro contable, conciliaciones y apoyo tributario. Busco consolidarme en un puesto de asistente contable con posibilidad de crecimiento.",
        exp: [
          { cargo: "Auxiliar Contable", empresa: "Comercial Los Olivos S.A.C. (ficticia)", periodo: "Abr 2022 - Actualidad", logros: ["Registré compras y ventas en el sistema Concar y generé reportes mensuales.", "Preparé conciliaciones bancarias de 3 cuentas con diferencias menores a 0.5%.", "Apoyé en la presentación de PDT 621 supervisado por el contador."] },
          { cargo: "Practicante de Contabilidad", empresa: "Estudio Contable Salas & Asociados (ficticio)", periodo: "Jun 2021 - Mar 2022", logros: ["Archivo y digitalización de documentos contables.", "Apoyo en elaboración de libros electrónicos."] },
        ],
        formacion: ["Bachiller en Contabilidad - Universidad Privada Ficticia del Norte (2017 - 2021)", "Curso de Excel Avanzado - Academia Ficticia de Negocios (2022)"],
        habilidades: ["Contabilidad general", "Concar", "Excel intermedio-avanzado", "Conciliaciones bancarias", "Nociones de tributación (IGV)"],
        idiomas: ["Español nativo", "Inglés básico (A2)"],
      },
      {
        nombre: "Patricia", apellido: "Salazar Cueva", titular: "Asistente Administrativa con interés en Contabilidad", ciudad: "Lima, Perú",
        resumen: "Asistente administrativa con experiencia en facturación y caja. Cursando contabilidad, con interés en pasar al área contable. Aprendizaje rápido y orden en el manejo de documentos.",
        exp: [
          { cargo: "Asistente Administrativa", empresa: "Ferretería El Progreso S.R.L. (ficticia)", periodo: "Feb 2020 - Actualidad", logros: ["Emití facturas y boletas electrónicas diarias.", "Controlé caja chica y arqueos semanales.", "Archivé y ordené documentación para el contador externo."] },
          { cargo: "Cajera", empresa: "Minimarket Santa Lucía (ficticio)", periodo: "Ene 2018 - Ene 2020", logros: ["Atención de caja y cuadre diario de ventas."] },
        ],
        formacion: ["Contabilidad (6.º ciclo de 10, en curso) - Instituto Superior Ficticio Lima Sur", "Secundaria completa - I.E. Ficticia N.º 0000"],
        habilidades: ["Facturación electrónica", "Excel básico-intermedio", "Control de caja", "Atención al cliente"],
        idiomas: ["Español nativo"],
      },
      {
        nombre: "Jorge", apellido: "Paredes Tello", titular: "Técnico en Mecánica Automotriz", ciudad: "Lima, Perú",
        resumen: "Técnico mecánico con 5 años de experiencia en mantenimiento de vehículos livianos. Busco cambiar de rubro hacia una posición administrativa.",
        exp: [
          { cargo: "Mecánico Automotriz", empresa: "Taller AutoSur E.I.R.L. (ficticio)", periodo: "Mar 2019 - Actualidad", logros: ["Diagnóstico y reparación de motores a gasolina y diésel.", "Mantenimiento preventivo de flota de 12 camionetas.", "Capacité a 2 ayudantes nuevos."] },
        ],
        formacion: ["Técnico en Mecánica Automotriz - Instituto Técnico Ficticio Industrial (2016 - 2018)"],
        habilidades: ["Diagnóstico mecánico", "Uso de scanner automotriz", "Trabajo en equipo", "Word básico"],
        idiomas: ["Español nativo"],
      },
    ],
  },
  {
    carpeta: "02_Ejecutivo_Comercial",
    cvs: [
      {
        nombre: "Andrea Milagros", apellido: "Vargas Linares", titular: "Ejecutiva Comercial B2B | Ventas de Soluciones Industriales", ciudad: "Lima, Perú",
        resumen: "Ejecutiva comercial con 7 años en ventas B2B consultivas para el sector industrial y minero. Cumplimiento sostenido de metas por encima del 110% y manejo de cartera de cuentas clave.",
        exp: [
          { cargo: "Ejecutiva Comercial Senior", empresa: "Insumos Industriales Cordillera S.A. (ficticia)", periodo: "Ene 2020 - Actualidad", logros: ["Superé la meta anual de ventas en 118%, 122% y 112% en tres años consecutivos.", "Capté 35 clientes nuevos del sector minero y construcción.", "Gestioné una cartera de 60 cuentas con facturación de S/ 4.5 millones anuales."] },
          { cargo: "Asesora Comercial", empresa: "Maquinarias del Pacífico S.A.C. (ficticia)", periodo: "Feb 2017 - Dic 2019", logros: ["Incrementé 30% las ventas de la línea de repuestos.", "Negocié contratos marco con 8 empresas medianas."] },
        ],
        formacion: ["Administración de Empresas - Universidad Ficticia del Pacífico (2012 - 2016), Título profesional", "Diplomado en Gestión Comercial y Ventas Consultivas (2019)"],
        habilidades: ["Venta consultiva B2B", "Prospección y cierre de ventas", "CRM (HubSpot, Salesforce)", "Negociación de contratos", "Elaboración de propuestas comerciales", "Excel y PowerPoint avanzados"],
        idiomas: ["Español nativo", "Inglés avanzado (C1)"],
      },
      {
        nombre: "Diego Martín", apellido: "Chávez Orellana", titular: "Asesor Comercial | Ventas y Atención de Cuentas", ciudad: "Lima, Perú",
        resumen: "Asesor comercial con 4 años de experiencia en ventas de productos de consumo masivo a bodegas y supermercados. Orientado a resultados y con buen manejo de CRM.",
        exp: [
          { cargo: "Asesor Comercial", empresa: "Bebidas Tambo Verde S.A.C. (ficticia)", periodo: "Mar 2022 - Actualidad", logros: ["Cumplí 104% de la meta trimestral promedio.", "Amplié la cartera en 40 puntos de venta nuevos.", "Registré visitas y pedidos en CRM Zoho."] },
          { cargo: "Vendedor de Campo", empresa: "Snacks Inti E.I.R.L. (ficticia)", periodo: "Jun 2020 - Feb 2022", logros: ["Visita diaria a 25 clientes en ruta.", "Recuperé 12 clientes inactivos."] },
        ],
        formacion: ["Marketing - Instituto Superior Ficticio de Negocios (2017 - 2020), Técnico profesional", "Curso de Técnicas de Negociación (2021)"],
        habilidades: ["Ventas en campo", "CRM Zoho", "Negociación básica", "Excel intermedio", "Atención de reclamos"],
        idiomas: ["Español nativo", "Inglés básico (A2)"],
      },
      {
        nombre: "Rocío", apellido: "Espinoza Barrios", titular: "Vendedora de Retail", ciudad: "Lima, Perú",
        resumen: "Vendedora de tienda con 2 años de experiencia en atención directa al público. Busco dar el paso a ventas a empresas.",
        exp: [
          { cargo: "Vendedora de Tienda", empresa: "Hogar y Decoración Miraflor S.A.C. (ficticia)", periodo: "Mar 2023 - Actualidad", logros: ["Atención a clientes finales en tienda y cierre de ventas en mostrador.", "Fui reconocida como vendedora del mes en 2 ocasiones."] },
          { cargo: "Promotora", empresa: "Eventos Promo Perú (ficticia)", periodo: "Ene 2022 - Feb 2023", logros: ["Promoción de productos en activaciones de marca."] },
        ],
        formacion: ["Administración (4.º ciclo, en curso) - Instituto Ficticio Cono Norte"],
        habilidades: ["Atención al cliente", "Venta directa en tienda", "Redes sociales básicas", "Excel básico"],
        idiomas: ["Español nativo"],
      },
      {
        nombre: "Fernando", apellido: "Gutiérrez Aliaga", titular: "Enfermero Técnico", ciudad: "Lima, Perú",
        resumen: "Técnico en enfermería con 6 años de experiencia en clínicas y centros de salud. Busco nuevas oportunidades laborales.",
        exp: [
          { cargo: "Técnico en Enfermería", empresa: "Clínica Ficticia San Gabriel (ficticia)", periodo: "Abr 2018 - Actualidad", logros: ["Apoyo en procedimientos de enfermería y toma de signos vitales.", "Atención de hasta 30 pacientes por turno."] },
        ],
        formacion: ["Técnico en Enfermería - Instituto Ficticio de Salud (2015 - 2017)"],
        habilidades: ["Primeros auxilios", "Trato al paciente", "Trabajo en equipo"],
        idiomas: ["Español nativo"],
      },
    ],
  },
  {
    carpeta: "03_Desarrollador_Web",
    cvs: [
      {
        nombre: "Sebastián", apellido: "Ramírez Cornejo", titular: "Desarrollador Full Stack | TypeScript, React, Node.js", ciudad: "Lima, Perú",
        resumen: "Desarrollador full stack con 6 años de experiencia construyendo aplicaciones web con React, Next.js y Node.js sobre PostgreSQL. Experiencia en despliegues en la nube, pruebas automatizadas y trabajo con metodologías ágiles.",
        exp: [
          { cargo: "Desarrollador Full Stack Senior", empresa: "Soluciones Digitales Quipu S.A.C. (ficticia)", periodo: "Feb 2021 - Actualidad", logros: ["Lideré la migración de un sistema interno a Next.js y TypeScript, reduciendo el tiempo de carga 45%.", "Diseñé APIs REST y consultas SQL optimizadas sobre PostgreSQL y Supabase.", "Implementé CI/CD con GitHub Actions y pruebas con Playwright y Jest (cobertura 80%)."] },
          { cargo: "Desarrollador Web", empresa: "Agencia Web Tupay E.I.R.L. (ficticia)", periodo: "Mar 2018 - Ene 2021", logros: ["Desarrollé más de 15 sitios y aplicaciones con React y Node.js.", "Integré pasarelas de pago y servicios de terceros."] },
        ],
        formacion: ["Ingeniería de Sistemas - Universidad Ficticia de Ingeniería (2012 - 2017), Título profesional", "Certificación Cloud Practitioner (ficticia) (2022)"],
        habilidades: ["TypeScript / JavaScript", "React y Next.js", "Node.js", "PostgreSQL y SQL", "Git y GitHub Actions", "Docker", "Pruebas automatizadas (Jest, Playwright)", "Metodologías ágiles (Scrum)"],
        idiomas: ["Español nativo", "Inglés avanzado (C1) - lectura técnica y reuniones"],
      },
      {
        nombre: "Valeria", apellido: "Ortiz Delgado", titular: "Desarrolladora Web | React y Node.js", ciudad: "Arequipa, Perú",
        resumen: "Desarrolladora web con 3 años de experiencia en interfaces con React y servicios con Node.js. Con ganas de profundizar en arquitectura y pruebas automatizadas.",
        exp: [
          { cargo: "Desarrolladora Web", empresa: "Tecnologías Misti S.A.C. (ficticia)", periodo: "Jun 2022 - Actualidad", logros: ["Desarrollé módulos de un panel administrativo en React y JavaScript.", "Creé endpoints en Node.js (Express) con base de datos MySQL.", "Participé en revisiones de código y sprints quincenales."] },
          { cargo: "Practicante de Desarrollo", empresa: "Startup Yaku Labs (ficticia)", periodo: "Ago 2021 - May 2022", logros: ["Corrección de errores y maquetación con HTML, CSS y React."] },
        ],
        formacion: ["Ingeniería de Software - Universidad Ficticia San Martín (2017 - 2021), Bachiller", "Curso de TypeScript - Plataforma Ficticia de Cursos (2023)"],
        habilidades: ["JavaScript", "React", "Node.js (Express)", "MySQL", "Git", "HTML y CSS", "TypeScript básico"],
        idiomas: ["Español nativo", "Inglés intermedio (B1)"],
      },
      {
        nombre: "Hugo", apellido: "Navarro Peña", titular: "Desarrollador Junior | PHP y WordPress", ciudad: "Lima, Perú",
        resumen: "Desarrollador junior con 1 año de experiencia en sitios WordPress y PHP. Autodidacta, buscando migrar a tecnologías modernas de JavaScript.",
        exp: [
          { cargo: "Desarrollador Junior", empresa: "Webs Rápidas Perú (ficticia)", periodo: "Mar 2025 - Actualidad", logros: ["Personalicé temas y plugins en WordPress.", "Mantenimiento de 10 sitios de clientes pequeños."] },
        ],
        formacion: ["Computación e Informática (egresado) - Instituto Ficticio Tecnológico (2021 - 2024)", "Curso de JavaScript básico (online, 2025)"],
        habilidades: ["PHP", "WordPress", "HTML y CSS", "JavaScript básico", "MySQL básico"],
        idiomas: ["Español nativo", "Inglés básico (A2)"],
      },
      {
        nombre: "Milagros", apellido: "Fuentes Zavala", titular: "Diseñadora Gráfica y Community Manager", ciudad: "Lima, Perú",
        resumen: "Diseñadora gráfica con 4 años creando piezas para redes sociales y material impreso. Sin experiencia en programación.",
        exp: [
          { cargo: "Diseñadora Gráfica", empresa: "Estudio Creativo Arcoíris (ficticio)", periodo: "Ene 2021 - Actualidad", logros: ["Diseñé más de 300 piezas para redes sociales.", "Administré cuentas de Instagram y Facebook de 6 marcas."] },
        ],
        formacion: ["Diseño Gráfico - Instituto Ficticio de Artes Visuales (2017 - 2020)"],
        habilidades: ["Photoshop", "Illustrator", "Canva", "Community management", "Fotografía de producto"],
        idiomas: ["Español nativo", "Inglés básico (A2)"],
      },
    ],
  },
  {
    carpeta: "04_Coordinador_Logistica",
    cvs: [
      {
        nombre: "Ricardo", apellido: "Villanueva Soto", titular: "Coordinador de Logística y Almacén", ciudad: "Callao, Perú",
        resumen: "Ingeniero industrial con 8 años en logística, almacenes y distribución. Experiencia en gestión de inventarios, compras y coordinación de transporte para operaciones con más de 3,000 SKU.",
        exp: [
          { cargo: "Coordinador de Logística", empresa: "Distribuciones Nevado S.A. (ficticia)", periodo: "Ene 2020 - Actualidad", logros: ["Reduje 35% los costos de transporte renegociando con 6 proveedores y optimizando rutas.", "Mejoré la exactitud de inventario de 91% a 99% con conteos cíclicos.", "Dirigí un equipo de 14 personas entre almacenistas y choferes."] },
          { cargo: "Supervisor de Almacén", empresa: "Almacenes Rímac del Sur S.A.C. (ficticia)", periodo: "Mar 2016 - Dic 2019", logros: ["Implementé un WMS que disminuyó 40% los errores de despacho.", "Gestioné recepción y despacho de 120 pedidos diarios."] },
        ],
        formacion: ["Ingeniería Industrial - Universidad Nacional Ficticia de Ingeniería (2009 - 2014), Título profesional", "Diplomado en Gestión de la Cadena de Suministro (2018)"],
        habilidades: ["Gestión de inventarios", "WMS y ERP (SAP MM)", "Planificación de rutas y transporte", "Negociación con proveedores", "Excel avanzado e indicadores (KPI)", "Seguridad en almacenes"],
        idiomas: ["Español nativo", "Inglés intermedio (B2)"],
      },
      {
        nombre: "Elena", apellido: "Castañeda Ríos", titular: "Analista de Almacén y Distribución", ciudad: "Lima, Perú",
        resumen: "Analista de logística con 4 años en almacén y distribución. Manejo de inventarios y coordinación de despachos; busca asumir la coordinación de un área.",
        exp: [
          { cargo: "Analista de Almacén", empresa: "Logística Express Tahuantinsuyo S.A.C. (ficticia)", periodo: "Mar 2022 - Actualidad", logros: ["Controlé inventarios de 1,500 SKU con una exactitud de 97%.", "Coordiné despachos diarios con 8 transportistas.", "Elaboré reportes semanales de indicadores en Excel."] },
          { cargo: "Asistente de Almacén", empresa: "Comercial Surco Norte S.A.C. (ficticia)", periodo: "Feb 2020 - Feb 2022", logros: ["Recepción, ubicación y picking de mercadería."] },
        ],
        formacion: ["Administración y Logística - Instituto Superior Ficticio (2016 - 2019), Técnico profesional", "Curso de Gestión de Inventarios (2021)"],
        habilidades: ["Control de inventarios", "Excel intermedio-avanzado", "Coordinación de transporte", "Sistema ERP básico", "Trabajo bajo presión"],
        idiomas: ["Español nativo", "Inglés básico (A2)"],
      },
      {
        nombre: "César", apellido: "Moreno Palacios", titular: "Auxiliar de Almacén", ciudad: "Lima, Perú",
        resumen: "Auxiliar de almacén con 2 años de experiencia en carga, descarga y orden de mercadería. Con ganas de aprender y crecer en logística.",
        exp: [
          { cargo: "Auxiliar de Almacén", empresa: "Importaciones Brisa S.A.C. (ficticia)", periodo: "May 2023 - Actualidad", logros: ["Recepción y almacenamiento de mercadería.", "Apoyo en inventarios anuales."] },
          { cargo: "Ayudante de Reparto", empresa: "Transportes Veloz E.I.R.L. (ficticia)", periodo: "Ene 2022 - Abr 2023", logros: ["Entrega de pedidos y control de guías de remisión."] },
        ],
        formacion: ["Secundaria completa - I.E. Ficticia N.º 0001", "Curso de Operador de Montacargas (2023)"],
        habilidades: ["Operación de montacargas", "Orden y limpieza", "Guías de remisión", "Excel básico"],
        idiomas: ["Español nativo"],
      },
      {
        nombre: "Natalia", apellido: "Bustamante Reyes", titular: "Psicóloga Clínica", ciudad: "Lima, Perú",
        resumen: "Psicóloga con 3 años de experiencia en consulta privada y terapia infantil. Busco ampliar mi campo laboral.",
        exp: [
          { cargo: "Psicóloga Clínica", empresa: "Centro Psicológico Armonía (ficticio)", periodo: "Feb 2022 - Actualidad", logros: ["Atención de 20 pacientes semanales.", "Talleres de habilidades sociales para niños."] },
        ],
        formacion: ["Psicología - Universidad Privada Ficticia (2015 - 2020), Título profesional"],
        habilidades: ["Evaluación psicológica", "Terapia cognitivo-conductual", "Empatía y escucha activa"],
        idiomas: ["Español nativo", "Inglés intermedio (B1)"],
      },
    ],
  },
  {
    carpeta: "05_Analista_Atencion_Cliente",
    cvs: [
      {
        nombre: "Daniela", apellido: "Ccopa Marín", titular: "Analista de Atención al Cliente y Experiencia", ciudad: "Lima, Perú",
        resumen: "Especialista en atención al cliente con 5 años en contact center y servicio postventa. Experiencia en gestión de reclamos, indicadores de calidad (NPS, CSAT) y capacitación de equipos.",
        exp: [
          { cargo: "Analista de Atención al Cliente", empresa: "Telecom Andes Perú S.A. (ficticia)", periodo: "Jun 2021 - Actualidad", logros: ["Resolví el 92% de reclamos en el primer contacto y mantuve un CSAT de 4.7/5.", "Reduje 25% el tiempo de respuesta a reclamos con nuevos flujos en Zendesk.", "Capacité a 18 asesores nuevos en protocolos de atención y manejo de quejas."] },
          { cargo: "Asesora de Contact Center", empresa: "Call Center Quilla S.A.C. (ficticia)", periodo: "Mar 2019 - May 2021", logros: ["Atendí más de 80 llamadas diarias con calificación de calidad de 95%.", "Fui asesora destacada en 4 trimestres."] },
        ],
        formacion: ["Administración de Servicios - Universidad Ficticia de Lima (2014 - 2018), Título profesional", "Diplomado en Experiencia del Cliente (2022)"],
        habilidades: ["Gestión de reclamos y quejas", "Zendesk y CRM", "Indicadores NPS, CSAT, TMO", "Capacitación de personal", "Comunicación asertiva", "Excel intermedio"],
        idiomas: ["Español nativo", "Inglés intermedio (B2)", "Quechua conversacional"],
      },
      {
        nombre: "Marco Antonio", apellido: "Huertas Lazo", titular: "Asesor de Servicio al Cliente", ciudad: "Lima, Perú",
        resumen: "Asesor de servicio al cliente con 3 años de experiencia en atención telefónica y por chat. Buen manejo de CRM y trato cordial con el cliente.",
        exp: [
          { cargo: "Asesor de Servicio al Cliente", empresa: "Seguros Horizonte S.A. (ficticia)", periodo: "Feb 2023 - Actualidad", logros: ["Atención de consultas por teléfono, correo y chat.", "Mantuve 90% de satisfacción en encuestas.", "Registro de casos en CRM Freshdesk."] },
          { cargo: "Asesor Telefónico", empresa: "Contacto Directo S.A.C. (ficticia)", periodo: "Mar 2021 - Ene 2023", logros: ["Cobranza amable y atención de consultas de clientes."] },
        ],
        formacion: ["Administración (egresado) - Instituto Ficticio Tecnológico (2018 - 2021)", "Curso de Atención al Cliente (2022)"],
        habilidades: ["Atención telefónica y chat", "CRM Freshdesk", "Manejo de objeciones", "Word y Excel básicos"],
        idiomas: ["Español nativo", "Inglés básico (A2)"],
      },
      {
        nombre: "Yesenia", apellido: "Torres Aguirre", titular: "Recepcionista y Apoyo Administrativo", ciudad: "Lima, Perú",
        resumen: "Recepcionista con 1 año de experiencia atendiendo visitas y llamadas. Responsable y puntual; sin experiencia en reclamos ni en sistemas CRM.",
        exp: [
          { cargo: "Recepcionista", empresa: "Consultorio Dental Sonrisa Sana (ficticio)", periodo: "Abr 2025 - Actualidad", logros: ["Atención de visitas, citas y llamadas.", "Control de agenda diaria."] },
        ],
        formacion: ["Secretariado Ejecutivo (en curso) - Instituto Ficticio de Lima"],
        habilidades: ["Recepción de visitas", "Manejo de agenda", "Word básico"],
        idiomas: ["Español nativo"],
      },
      {
        nombre: "Óscar", apellido: "Lozano Medina", titular: "Chofer Profesional", ciudad: "Lima, Perú",
        resumen: "Conductor profesional con 10 años de experiencia en transporte de personal. Licencia A-IIb vigente (ficticia).",
        exp: [
          { cargo: "Chofer", empresa: "Transportes Turismo Andino (ficticio)", periodo: "Ene 2015 - Actualidad", logros: ["Traslado diario de personal de empresas sin accidentes.", "Cumplimiento de horarios y mantenimiento básico del vehículo."] },
        ],
        formacion: ["Secundaria completa - I.E. Ficticia N.º 0002"],
        habilidades: ["Conducción defensiva", "Conocimiento de rutas de Lima", "Puntualidad"],
        idiomas: ["Español nativo"],
      },
    ],
  },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html(cv: Cv, tel: string, correo: string): string {
  const exp = cv.exp
    .map(
      (e) => `<div class="item"><div class="row"><b>${esc(e.cargo)}</b><span>${esc(e.periodo)}</span></div>
<div class="emp">${esc(e.empresa)}</div><ul>${e.logros.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`,
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>CV ${esc(cv.nombre)} ${esc(cv.apellido)}</title>
<style>
@page { margin: 14mm 16mm; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #222; line-height: 1.35; margin: 0; }
h1 { font-size: 22pt; margin: 0; color: #1f3a5f; }
.tit { font-size: 11.5pt; color: #444; margin: 2px 0 4px; }
.contacto { font-size: 9.5pt; color: #555; border-bottom: 2px solid #1f3a5f; padding-bottom: 6px; }
h2 { font-size: 11pt; text-transform: uppercase; color: #1f3a5f; border-bottom: 1px solid #ccc; margin: 14px 0 6px; padding-bottom: 2px; }
.row { display: flex; justify-content: space-between; }
.row span { color: #555; font-size: 9.5pt; }
.emp { font-style: italic; color: #444; }
ul { margin: 3px 0 8px 18px; padding: 0; }
li { margin-bottom: 2px; }
.item { page-break-inside: avoid; }
.nota { margin-top: 16px; font-size: 8pt; color: #888; }
</style></head><body>
<h1>${esc(cv.nombre)} ${esc(cv.apellido)}</h1>
<div class="tit">${esc(cv.titular)}</div>
<div class="contacto">${esc(correo)} | Tel. ${esc(tel)} | ${esc(cv.ciudad)}</div>
<h2>Resumen profesional</h2><p>${esc(cv.resumen)}</p>
<h2>Experiencia laboral</h2>${exp}
<h2>Formación</h2><ul>${cv.formacion.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<h2>Habilidades</h2><ul>${cv.habilidades.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<h2>Idiomas</h2><ul>${cv.idiomas.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<div class="nota">CV ficticio generado para pruebas. Nombres, empresas y datos inventados.</div>
</body></html>`;
}

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "");

async function main() {
  const raiz = path.resolve(import.meta.dirname, "..", "cv-prueba");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let n = 0;
  for (const p of PUESTOS) {
    const dir = path.join(raiz, p.carpeta);
    mkdirSync(dir, { recursive: true });
    for (const cv of p.cvs) {
      n++;
      const nn = String(n).padStart(2, "0");
      const apellido = sinTildes(cv.apellido.split(" ")[0]);
      const nombre = sinTildes(cv.nombre.split(" ")[0]);
      const correo = `${sinTildes(cv.nombre.split(" ")[0]).toLowerCase()}.${apellido.toLowerCase()}@example.com`;
      await page.setContent(html(cv, `999 000 0${nn}`, correo), { waitUntil: "load" });
      const archivo = path.join(dir, `CV_${apellido}_${nombre}.pdf`);
      await page.pdf({ path: archivo, format: "A4", printBackground: true });
      console.log("OK", archivo);
    }
  }
  await browser.close();
  console.log(`Generados ${n} CVs en ${raiz}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
