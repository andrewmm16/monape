# Vías oficiales para recibir postulaciones y CV de portales de empleo peruanos y latinoamericanos en una plataforma propia

Consultas hechas el 28/10/2026, salvo que se indique otra fecha. Marcas de verificación en cada hallazgo:
- **[V]**: página oficial abierta y leída ese día.
- **[B]**: solo extracto o resumen del buscador; la página no se abrió o se mostró vacía (Pandapé y Computrabajo cargan su contenido con JavaScript y la herramienta de lectura los devolvió en blanco).
- **[S]**: fuente secundaria (prensa, directorios, terceros).
- **[D]**: dato ya verificado el 27/10/2026 en `docs/opcion-robot.md` u `docs/opcion-correos-de-aviso.md`. Se cita solo para completar, sin repetirlo.

La lectura de condiciones de uso es técnica y no constituye una opinión legal.

## 1. Bumeran Perú, Konzerta, Aptitus y Laborum (grupo Jobint, antes Navent): API, socios, ATS, exportación y correos

### Takeaway
No se encontró ninguna API pública de Bumeran, ningún programa de socios ATS documentado ni ninguna exportación oficial a Excel. La única conexión oficial observada es de salida: el ATS HiringRoom, del mismo grupo, publica avisos en Bumeran y sus marcas hermanas. HiringRoom no publica una API para pasar postulaciones a un sistema propio. Otros ATS, como Manatal o iSmartRecruit, publican en Bumeran con el contrato de la empresa, pero ninguno confirma que las postulaciones de Bumeran vuelvan automáticamente al ATS.

### Cited Findings
**Grupo y marcas**
- [S] Tras separarse del Grupo Navent en 2021, Jobint agrupa a Bumeran, la comercialización de la plataforma Hiring Room y Selecta, una agencia de reclutamiento en línea. Es un extracto de buscador atribuido a una nota de Gestión. — [Gestión](https://gestion.pe/economia/empresas/bumeran-busca-ampliar-cartera-de-clientes-en-regiones-apalancado-en-nuevas-inversiones-noticia/)
- [S] La venta de Navent a QuintoAndar excluyó el negocio de empleo con la marca Bumeran. — [LexLatin](https://lexlatin.com/noticias/quintoandar-se-expande-america-latina-compra-negocio-inmobiliario-navent)
- [S] HiringRoom pasó a estar bajo el paraguas de Navent y Bumeran. — [El Cronista](https://www.cronista.com/infotechnology/entreprenerds/conoce-la-nueva-plataforma-de-rrhh-que-deja-entrevistar-candidatos-online) (nota sin fecha visible en el extracto)
- [V] Manatal describe a Bumeran como la principal plataforma de reclutamiento en Argentina, México, Venezuela y Perú, con marcas afiliadas en Chile (Laborum), Ecuador (Multitrabajos) y Panamá (Konzerta). — [Manatal, integración Bumeran](https://www.manatal.com/integrations/my-contract-bumeran)
- [S] Aptitus: Navent Group, a través de sus filiales Bumeran.com y E-Holding, compró los portales Urbania y Aptitus a Empresa Editora El Comercio. Según CB Insights, la compra se cerró el 10/12/2019. En 2019, Navent evaluaba si Bumeran absorbería a Aptitus o si ambas marcas convivirían. — [Gestión, 2019](https://gestion.pe/economia/empresas/navent-group-ltd-concreto-compra-de-clasificados-urbania-y-aptitus-del-grupo-el-comercio-noticia/); [CB Insights](https://www.cbinsights.com/company/aptitus)

**HiringRoom, el ATS del grupo**
- [V] Artículo de ayuda del 18/09/2023, *«Publicar aviso Talento / Select (Bumeran, Zonajobs, Laborum, Konzerta, Multitrabajos)»*:
  - Los avisos Bumeran TALENTO / Zonajobs SELECT son gratuitos y *«se publican de forma automática al publicar la vacante»*.
  - El proceso aplica a Bumeran, Zona Jobs, Multitrabajos, Konzerta y Laborum.
  - Para obtener el CV de un postulante se usa un *«crédito de búsqueda en base»*. El saldo se ve en *Configuración / Conexión con portales de empleo*.
  - El aviso puede mejorarse a uno de pago, entre los tipos de aviso disponibles en la cuenta.
  - El artículo no dice si los postulantes de Bumeran entran automáticamente a HiringRoom con su CV.

  — [HiringRoom, ayuda](https://intercom.help/hiringroom/es/articles/8386498-publicar-aviso-talento-select-bumeran-zonajobs-laborum-konzerta-multitrabajos)
- [V] La página de integraciones de HiringRoom solo enumera 10 herramientas: Amitai, Calendly, EB Metrics, Genoma Work, Hirint, Hunty, Kelsoft, Kokoro, Kudert y PDA. No menciona portales de empleo, API pública, webhooks, Zapier ni documentación para desarrolladores. — [hiringroom.com/integraciones](https://hiringroom.com/integraciones)
- [B] Según sus términos de contratación, la plataforma viene preintegrada con portales de pago o gratuitos (LinkedIn, Indeed, Facebook). El precio se fija en una «orden particular de servicios». — [Términos y condiciones de HiringRoom](https://hiringroom.com/hiringroom/terminos_y_condiciones)
- [B] La API de HiringRoom solo aparece para integraciones de entrada, como pegar la clave API de Calendly o de KeyClouding en Configuración > Integraciones. No se encontró una API de HiringRoom para sacar datos. — resultados de búsqueda en hiringroom.com e intercom.help (28/10/2026)

**ATS de terceros que publican en Bumeran**
- [V] Manatal: *«Manatal integrates seamlessly with Bumeran through the "My Own Contracts" feature»*. Permite *«connect their existing Bumeran accounts to Manatal»* y *«post jobs directly from Manatal to Bumeran»*. No dice que las postulaciones o los CV vuelvan a Manatal. No publica el precio de la integración; ofrece una prueba gratuita de 14 días. — [Manatal](https://www.manatal.com/integrations/my-contract-bumeran)
- [B] Manatal afirma en general que, al conectar un portal, los candidatos que postulan quedan con perfil creado en Manatal. No es una afirmación específica sobre Bumeran. — [Manatal, sourcing](https://www.manatal.com/features/candidate-sourcing)
- [V] iSmartRecruit: *«post job openings on Bumeran directly through iSmartRecruit while efficiently managing applications in a centralised platform»*. Menciona una «data synchronisation» sin detallar qué se sincroniza. No indica precio, requisitos, API ni fecha. — [iSmartRecruit](https://www.ismartrecruit.com/integration/sponsored-job-board/bumeran)

**API, exportación y condiciones**
- [B] Las búsquedas de API para empresas, programa de partners o exportación de postulantes a Excel no devolvieron ninguna página oficial de Bumeran ni de Jobint. — búsquedas del 28/10/2026
- [D] Las condiciones de Bumeran Perú prohíben *«el uso o intento de uso de cualquier máquina, software, herramienta, agente u otro mecanismo para navegar o buscar en el Sitio Web que sean distintos a las herramientas de búsqueda provistos por BUMERAN»* y compartir la contraseña. No regulan los correos de aviso ni cómo guarda la empresa los datos. Las versiones son los Términos de Uso del 8/7/2024 y las Condiciones de Contratación del 10/4/2025. — `docs/opcion-robot.md`, `docs/opcion-correos-de-aviso.md`

### Inferences
- La única vía oficial de sistema a sistema hacia Bumeran que se observa es su propio ATS, HiringRoom, y es **de salida** (publicar avisos). Que el CV cueste un «crédito de búsqueda en base» indica que incluso dentro de HiringRoom el acceso al CV de los avisos gratuitos no es libre.
- Integrar Bumeran con la plataforma propia por una vía oficial requeriría un acuerdo comercial con Bumeran o Jobint, que hay que pedir por escrito. Mientras tanto, siguen siendo válidas la carga masiva y, si la prueba real lo confirma, el correo de aviso.
- Konzerta, Laborum y Multitrabajos operan en Panamá, Chile y Ecuador, no en Perú. Para una empresa peruana solo importan si recluta en esos países, y comparten el mismo mecanismo de HiringRoom.

### Gaps
- No se sabe si HiringRoom trae al ATS los postulantes de Bumeran con su CV, ni si tiene una API de salida o webhooks. Se debe preguntar a soporte@hiringroom.com, contacto que figura en su ayuda.
- No se encontró el precio de HiringRoom ni si tiene plan gratuito; solo consta una prueba gratuita.
- No se sabe si Bumeran Perú permite exportar postulantes a Excel o descargar los CV en lote desde su panel. No hay ayuda pública; se debe revisar con una cuenta real.
- El estado actual de Aptitus en 2026 (absorbida, redirigida o activa) no está confirmado; las fuentes son de 2019 y 2020.

## 2. Computrabajo Perú (Redarbor / DGNET) y Pandapé: API, integración, cláusula sobre la base de CV y precio

### Takeaway
Computrabajo no publica una API para ATS ajenos. Su única integración oficial es Pandapé, el ATS de su mismo grupo, que se declara «el único ATS integrado con Computrabajo». Las condiciones legales autorizan a guardar datos de candidatos fuera del portal solo con:
- la herramienta de reclutamiento de DGNET;
- otras herramientas «autorizadas», cuya lista pública no se encontró;
- una autorización expresa por escrito.

Pandapé tiene una API solo para integraciones a medida, que gestiona el responsable de la cuenta. No tiene precio público ni plan gratuito: se cotiza por contratos de 6 o 12 meses.

### Cited Findings
**Condiciones legales de Computrabajo**
- [D] Texto de las Condiciones Legales de Computrabajo Perú, actualizadas el 14/10/2026 y verificadas el 27/10/2026:

  > «En ningún caso, se otorga permiso al Usuario Profesional para almacenar los datos de los Candidatos para otros anuncios de trabajo ni para constituir una base de datos privada de CVs ni para cualquier otro uso distinto a la finalidad del Portal Web, salvo que ello sea permitido por DGNET, ya sea mediante el uso de la herramienta de software de reclutamiento ofrecida por el mismo y otras autorizadas o mediante autorización expresa por escrito.»

  Las mismas condiciones dicen:
  - la gestión de los procesos de selección se hace *«mediante el uso de las herramientas ofrecidas por el portal web y dentro del mismo, o bien, mediante la herramienta de software de reclutamiento ofrecida por DGNET. Cualquier otro uso está terminantemente prohibido»*;
  - *«El acceso o lectura mediante robots o programas automáticos no está permitido»*.

  — [pe.computrabajo.com/avisolegal](https://pe.computrabajo.com/avisolegal/), según `docs/opcion-correos-de-aviso.md` y `docs/opcion-robot.md`. El 28/10/2026 la herramienta de lectura devolvió la página vacía, así que no se volvió a leer.
- [B] Los avisos de privacidad de las ofertas de pe.computrabajo.com nombran a **DGNET LTD.** como responsable de los datos. Indican que el acceso se extiende a sus proveedores de servicios y a otras empresas de su grupo. — extracto de búsqueda sobre páginas de ofertas de [pe.computrabajo.com](https://pe.computrabajo.com/empresas/ofertas-de-trabajo-de-logistica-integral-sac-83EA83BF728ECCFA)

**Exportación desde el panel de Computrabajo**
- [B] El centro de soporte de Computrabajo para empresas, sección «Gestión de candidatos», tiene un artículo titulado *«¿Cómo exportar la base de candidatos postulados?»*. Solo se vio el título: la URL redirige a computrabajo.com y no se pudo leer su contenido. — [soporte.computrabajo.com, Gestión de candidatos](https://soporte.computrabajo.com/hc/es/sections/15554639888530-Gesti%C3%B3n-de-candidatos)

**Pandapé, el ATS del grupo**
- [V] Artículo de ayuda de Pandapé sobre Computrabajo, del 24/11/2025:
  - la publicación se activa con el interruptor de Computrabajo en los datos de publicación de la vacante, si Computrabajo está habilitado en la configuración del publicador;
  - *«There is no need to re-enter the vacancy information in the job portal, as it is automatically synchronized»*;
  - se puede *«start receiving applications from interested candidates immediately»*;
  - está disponible en *«ALL PLANS»*;
  - las ofertas destacadas y urgentes consumen créditos de Computrabajo, que se renuevan cada mes, y para tener más créditos hay que subir de categoría de membresía;
  - no menciona API ni webhooks.

  — [supportcenter.pandape.com](https://supportcenter.pandape.com/hc/en-us/articles/41246088775953)
- [B] Pandapé se presenta como *«el único ATS integrado con Computrabajo»*, con acceso a más de 60 millones de candidatos en Latinoamérica (cifra del propio proveedor). Dice publicar en 18 fuentes de reclutamiento con un clic. — [Pandapé, ATS para pymes](https://www.pandape.com/en/ats-smes/)
- [B] Pandapé declara integraciones nativas con portales como Computrabajo y OCC. También ofrece conexión con sistemas internos de RR. HH., ERP o plataformas de gestión *«mediante integraciones a medida a través de su API»*; el responsable de la cuenta o el *Customer Success Specialist* entrega la información para integrarse. — [Pandapé, grandes empresas](https://www.pandape.com/en/large-enterprises/); [Pandapé, integraciones](https://www.pandape.com/integraciones/); [Preguntas frecuentes](https://www.pandape.com/preguntas-frecuentes/); [Kit del reclutador: integración OCC](https://recursos.pandape.com/integracion-occ)
- [B] Planes y pago de Pandapé:
  - tres planes: Essential, Pro (añade videoentrevistas, chatbot y automatización) y Premium (añade publicación de ofertas, reclutamiento interno y evaluaciones);
  - precio por **cotización personalizada**, sin montos publicados; para conocerlo hay que pedir una demo;
  - contratos de 6 y 12 meses, con pago único o trimestral;
  - la formación inicial y el soporte están incluidos.

  — [Planes y precios](https://www.pandape.com/planes/); [Cuánto vale Pandapé](https://www.pandape.com/blog/cuanto-vale-pandape-precio/); [Preguntas frecuentes](https://www.pandape.com/preguntas-frecuentes/)
- [B] La pregunta frecuente *«¿Pandapé permite acceder a la base de candidatos de Computrabajo?»* existe, pero no se pudo leer su respuesta. — [Pandapé FAQ](https://www.pandape.com/faq/pandape-permite-acceder-a-la-base-de-candidatos-de-computrabajo/)

**Fuentes secundarias**
- [S] Una guía de terceros afirma que Computrabajo no admite integraciones con ATS externos. Es una afirmación sin respaldo oficial. — [Workello](https://workello.com/peru-job-boards)

**Herramientas PROHIBIDAS**
- [B] En Apify se ofrecen extractores no oficiales de Computrabajo, por ejemplo *Computrabajo LATAM Jobs Scraper*. Quedan **PROHIBIDOS** por la cláusula «El acceso o lectura mediante robots o programas automáticos no está permitido». — [Apify, extractor 1](https://apify.com/hernan_restrepo/computrabajo-jobs-scraper.md); [Apify, extractor 2](https://apify.com/scrapestorm/computrabajo-jobs-scraper---cheap-barato)

### Inferences
- La única vía oficial y automática para recibir postulaciones de Computrabajo es contratar Pandapé. Que esas postulaciones lleguen después a la plataforma propia dependería de una integración a medida con su API. Esa API no es pública y se negocia con el responsable de la cuenta. Ninguna de las dos cosas es gratuita.
- Aun con Pandapé, copiar los CV a la plataforma propia podría contar como formar una «base de datos privada de CVs». Por eso conviene que el contrato o una autorización escrita de DGNET autoricen expresamente ese flujo. La cláusula menciona «otras autorizadas», lo que sugiere que DGNET puede autorizar otras herramientas caso por caso.
- La pregunta para Computrabajo debe ser concreta: ¿autoriza por escrito que la empresa guarde en su sistema propio los CV de los postulantes a sus avisos, para esa vacante y con un plazo de borrado?

### Gaps
- No se encontró la lista de «otras [herramientas] autorizadas» por DGNET, ni el procedimiento para pedir la autorización escrita.
- No hay documentación técnica pública de la API de Pandapé: endpoints, eventos, si expone postulaciones con CV y si cobra aparte.
- No se sabe si existe un plan Pandapé de bajo costo ni cuánto cuesta el plan Essential.
- No se pudo leer qué incluye la exportación de candidatos de Computrabajo (Excel con datos o con CV) ni en qué planes está.

## 3. Get on Board, Trabajando.com y Universia, Trabajos Diarios, Empleos Perú (MTPE), Certificado Único Laboral, bolsas universitarias y otros

### Takeaway
**Get on Board es el único portal de la lista con una API documentada y webhooks que incluyen postulaciones.** Es de pago: según su ayuda, desde el plan Recruiter, que figura a 500 USD al mes en contrato anual. Además, se especializa en talento tecnológico.

Empleos Perú (MTPE) es gratuito, pero no tiene API ni integración. El Certificado Único Laboral (CERTIJOVEN o CERTIADULTO) no es una bolsa de empleo, sino un certificado que el empleador puede verificar.

Para Trabajando.com y Universia, Trabajos Diarios y las bolsas universitarias no se encontró ninguna API ni integración oficial.

### Cited Findings
**Get on Board**
- [V] Manual de la API:
  - la API **pública** *«is open to anyone»* y expone lo visible sin iniciar sesión: categorías, empresas, empleos publicados y búsqueda;
  - la API **privada** requiere autenticación y da acceso a *jobs, recruitment processes, professionals, and applications* de la empresa;
  - es *«exclusive for companies with an active subscription to any of our plans»*;
  - la clave API está en la configuración de la empresa;
  - la referencia técnica está en getonbrd.com/api-doc.html (api-doc.getonbrd.com redirige allí con 301), pero no se pudo leer porque carga con JavaScript.

  — [Get on Board's API](https://www.getonbrd.com/user-manual/get-on-board-s-api); [API Reference](https://www.getonbrd.com/api-doc.html)
- [V] La API privada permite *«Retrieve applications and candidate information your company is allowed to access»* y ver procesos y etapas. *«Private API access is available on Recruiter and higher subscription plans.»* No menciona descarga de CV, respuestas ni cambio de etapa. Actualizado hace unos 6 meses. — [What can I do with Get on Board's API?](https://www.getonbrd.com/help/what-can-i-do-with-get-on-board-s-api)
- [V] Eventos de webhook para empresas:
  - *«A job is created»*;
  - *«A job is updated»*;
  - *«A candidate sends an application»*;
  - *«A candidate withdraws an application»*;
  - *«A professional sends a message»*.

  *«Your webhook settings only show the events available for your account and plan.»* Los campos, la autenticación y la entrega se remiten a la documentación de la API. Actualizado hace alrededor de un mes. — [Webhook events](https://www.getonbrd.com/help/what-webhook-events-does-get-on-board-send)
- [B] Otros detalles técnicos, sin verificar en la referencia:
  - los webhooks son exclusivos del plan Recruiter o superior;
  - los nombres técnicos de los eventos serían `job.created`, `job.updated`, `job.application.sent`, `job.application.withdrawn` y `professional.message.created`;
  - la clave se envía como *Bearer token*;
  - la guía recomienda tratar el webhook como un aviso y luego pedir la postulación por su ID a la API.

  — [What are Get on Board's Webhooks useful for?](https://www.getonbrd.com/help/what-are-get-on-board-s-webhooks-useful-for); resultados de búsqueda en getonbrd.com
- [V] Para probar antes de comprar se puede *«ask our team about temporary access for private API testing»*; *«we can review whether temporary access or a sandbox company is available»*. — [How can I test the API before purchasing a plan?](https://www.getonbrd.com/help/how-can-i-test-get-on-board-s-api-before-purchasing-a-plan)
- [V] Precios en USD, sin impuestos, según su página de planes:

  | Plan | Precio |
  |---|---|
  | Pago por aviso | 150 USD por aviso; sin API |
  | Recruiter + Superpower AI | 500 USD/mes anual · 633 trimestral · 800 mensual |
  | Recruiter + Boost | 690 · 883 · 1.100 USD/mes |
  | Corporate | 758 o 928 USD/mes anual |
  | Unlimited | 1.008 o 1.248 USD/mes |

  La viñeta *«API and Lever/Greenhouse/Ashby integration»* también aparece en tarjetas de los planes Growth (460 USD/mes) y Scale. Esto **contradice** la ayuda, que la limita a Recruiter o superior. — [getonbrd.com/plans](https://www.getonbrd.com/plans)
- [V] La exportación a CSV solo está disponible *«on plans that include CSV downloads and only for unlocked processes»*. Incluye la fase, la puntuación, la pretensión salarial y los enlaces de contacto o perfil; no menciona el CV. — [Export applicants to CSV](https://www.getonbrd.com/help/export-applicants-to-csv)
- [B] El ATS de Get on Board es gratuito y publicar avisos es gratis. Para ver los datos de los postulantes hay que pagar el aviso o tener un plan. Su público es talento tecnológico en Latinoamérica. — [Free ATS](https://www.getonbrd.com/free-ats)

**Empleos Perú (MTPE)**
- [S] Las empresas publican vacantes gratis y sin límite, y el sistema sugiere postulantes compatibles con un porcentaje de coincidencia. Nota de 2022. — [La República, 06/09/2022](https://larepublica.pe/datos-lr/2022/09/06/mtpe-lanza-nueva-bolsa-de-trabajo-para-promover-mas-de-140-mil-puestos-laborales)
- [S] Las empresas acceden gratis a una base de candidatos. — [DPL News](https://dplnews.com/peru-mas-de-11-mil-empleos-se-ofertan-en-la-plataforma-del-ministerio-de-trabajo/)
- [S] Las empresas deben registrarse en Empleos Perú para publicar ofertas, con su RUC según un sitio de terceros que no es oficial. — [Infomercado](https://infomercado.pe/mtpe-ubico-a-1133-personas-en-un-puesto-de-empleo-formal-090123-gb/); [Trámites Perú](https://tramitesperu.com/mtpe/empleos-peru/)
- [S] Según el titular de una nota de 2022, el 73 % de las convocatorias de Empleos Perú no tuvo postulantes. — [La República, 07/09/2022](https://larepublica.pe/economia/2022/09/07/ministerio-de-trabajo-73-de-convocatorias-en-la-web-empleos-peru-no-tuvo-postulantes-computrabajo-bolsa-de-trabajo-convocatoria-de-trabajo-atmp)
- [B] Las vacantes del sector público siguen otro camino (www.empleosperu.gob.pe/vacantespublicas). — [Documento MTPE «Vacante Pública»](https://cdn.www.gob.pe/uploads/document/file/186993/Vacante_Publica.pdf)
- [B] No se encontraron condiciones de uso para empleadores, API, feed ni integración con ATS. — búsquedas del 28/10/2026; la guía oficial [Registrarte en Empleos Perú](https://www.gob.pe/23434-registrarte-en-empleos-peru) trata solo del lado del postulante.

**Certificado Único Laboral (CERTIJOVEN y CERTIADULTO)**
- [B] Es un documento oficial y gratuito del MTPE que reúne datos personales, antecedentes policiales, penales y judiciales, estudios y experiencia laboral formal, tomados de la Plataforma de Interoperabilidad del Estado. Su base legal es la Ley N.° 31760. El empleador puede verificar su autenticidad en Empleos Perú con el número del certificado y el DNI del titular. — [Preguntas frecuentes del CUL](https://www.empleosperu.gob.pe/CertificadoUnicoLaboral/PreguntasFrecuentes.html); [gob.pe, Verificar Certificado Único Laboral](https://www.gob.pe/23661-verificar-certificado-unico-laboral); [Ley N.° 31760](https://www.gob.pe/institucion/mtpe/normas-legales/4618262-31760)

**Trabajando.com y Universia**
- [S] La Comunidad Laboral Universia–Trabajando.com abarca once países, entre ellos Perú. Fuente universitaria española sin fecha visible. — [Universidad de Burgos](https://www.ubu.es/node/38368); [News is my Business](https://newsismybusiness.com/universia-trabajando-portal/)
- [S] Trabajando.com es un portal chileno fundado en 1999. — [Descubre.vc](https://www.descubre.vc/trabajando)
- [B] No se encontró API, integración con ATS, condiciones ni precios de Trabajando.com o Universia para Perú. — búsquedas del 28/10/2026

**Bolsas universitarias peruanas**
- [B] La Universidad Nacional del Callao (UNAC) publica una guía de acceso para empresas. El PDF no se pudo leer; el extracto dice que la empresa se registra y publica sus ofertas, que también pueden aparecer en Universia y en portales aliados. — [Guía de la bolsa de trabajo UNAC para empresas](https://unac.edu.pe/wp-content/uploads/documentos/osg/Procedimientos/GUIA-DE-ACCESO-DE-BOLSA-DE-TRABAJO-UNAC---EMPRESAS.pdf)
- [B] La Universidad del Pacífico tiene una bolsa propia en la que el postulante adjunta su CV. — [Manual de la bolsa UP](https://www.up.edu.pe/bolsadetrabajo/docs_/bolsa-de-trabajo-manual-de-uso.pdf)
- [S] Symplicity se menciona como plataforma para gestionar contactos con empleadores en una nota sobre inserción de egresados. No se confirmó qué universidades peruanas la usan. — [Gestión](https://gestion.pe/economia/empleo-plataforma-digital-promueve-insercion-de-egresados-al-mercado-laboral-rmmn-noticia/)

**Otros portales**
- [D] Trabajos Diarios: sus condiciones no mencionan robots y limitan el uso de los datos a fines de reclutamiento. No se encontró nada nuevo sobre una API o una exportación. — `docs/opcion-robot.md`
- [B] TopTrabajos (Perú) dice que las empresas pueden publicar vacantes sin costo. Sin información sobre integraciones. — [TopTrabajos](https://www.toptrabajos.com/pe/empleos/profesor)
- OCC Mundial es un portal mexicano; solo aparece como integración nativa de Pandapé (ver la sección 2). Jobsite no se investigó.

### Inferences
- Get on Board es el único caso en que «recibir automáticamente en el sistema propio» está documentado oficialmente. Lo que construiría un desarrollador:
  1. un receptor HTTPS público del webhook de nueva postulación, análogo al receptor de Talent Apply que ya existe;
  2. la verificación de autenticidad que indique la referencia técnica, todavía no leída;
  3. una consulta con la clave privada para traer la postulación y sus datos;
  4. el paso de esos datos por la misma ruta de registro, duplicados y evaluación que la carga masiva;
  5. guardar la clave API cifrada en variables de entorno.

  Solo compensa si la empresa contrata perfiles tecnológicos y paga el plan Recruiter, o el que Get on Board confirme.
- Empleos Perú y las bolsas universitarias son gratuitas, pero manuales. Se integran con lo que ya existe: la página pública de la vacante enlazada desde el aviso o la carga masiva.
- El Certificado Único Laboral podría pedirse como adjunto opcional del formulario propio y verificarse a mano en gob.pe. No es una vía de entrada de postulaciones.

### Gaps
- No se leyó la referencia técnica de Get on Board (renderizada con JavaScript). Quedan sin confirmar los endpoints exactos, si la postulación incluye el enlace al CV, la firma del webhook y los límites de uso.
- La contradicción entre la ayuda («Recruiter o superior») y la página de planes (API listada en Growth y Scale) debe aclararse con ventas de Get on Board.
- No se encontraron las condiciones de uso de Empleos Perú para empleadores ni de las bolsas universitarias; no se puede citar su cláusula sobre acceso automatizado ni sobre bases de CV.
- Trabajando.com y Universia: no se sabe si en 2026 siguen operando para empresas en Perú ni con qué condiciones.

## 4. Proveedores ATS o de multiposting con integración oficial con Bumeran o Computrabajo y API o webhook hacia una plataforma propia

### Takeaway
No se encontró ningún proveedor que reúna las tres condiciones: gratuito o barato, con integración oficial que traiga postulaciones de Bumeran o Computrabajo, y con API o webhook público para pasarlas a otro sistema.
- **Pandapé** tiene la integración oficial con Computrabajo, pero su API es a medida y su precio, cotizado.
- **HiringRoom** publica en Bumeran y sus marcas, pero no publica una API.
- **Manatal** e **iSmartRecruit** publican en Bumeran, pero no confirman que las postulaciones vuelvan.
- **Bizneo** y **Zoho Recruit** no declaran integración con Bumeran ni con Computrabajo.
- **Talento Cloud** no se investigó.

### Cited Findings
- [V] Pandapé (Computrabajo): la integración figura en «ALL PLANS» y la vacante se sincroniza sola. — [supportcenter.pandape.com](https://supportcenter.pandape.com/hc/en-us/articles/41246088775953). [B] Su API es para integraciones a medida y se gestiona con el responsable de la cuenta; precio cotizado. — [Pandapé, grandes empresas](https://www.pandape.com/en/large-enterprises/); [Planes](https://www.pandape.com/planes/)
- [V] HiringRoom (Bumeran, Zonajobs, Laborum, Konzerta, Multitrabajos): publica avisos gratuitos automáticamente y el CV cuesta un crédito. Su página de integraciones no menciona API ni webhooks. — [ayuda de HiringRoom](https://intercom.help/hiringroom/es/articles/8386498-publicar-aviso-talento-select-bumeran-zonajobs-laborum-konzerta-multitrabajos); [Integraciones](https://hiringroom.com/integraciones)
- [V] Manatal (Bumeran con el contrato de la empresa): publica avisos; no confirma que lleguen postulaciones de vuelta; prueba de 14 días. — [Manatal](https://www.manatal.com/integrations/my-contract-bumeran). [B] Manatal tiene una integración con Zapier documentada en su ayuda; no se leyó. — [Zapier Integration](https://support.manatal.com/docs/zapier-integration)
- [V] iSmartRecruit (Bumeran): publica avisos y menciona la gestión de postulaciones sin detalle; no indica precio ni API. — [iSmartRecruit](https://www.ismartrecruit.com/integration/sponsored-job-board/bumeran)
- [B] Bizneo: anuncia publicación en LinkedIn, Indeed y más de 60 plataformas «premium»; las cifras de terceros varían entre 70 y 200 portales. No se confirmó integración con Bumeran ni con Computrabajo. — [Bizneo ATS](https://www.bizneo.com/en/recruiting-software-applicant-tracking-system)
- [B] Zoho Recruit: tiene API y conexiones por Zapier, pero no se encontró integración documentada con Bumeran ni con Computrabajo. — [Zoho Recruit, integraciones](https://www.zoho.com/recruit/easy-integrations.html)
- [V] Get on Board es portal y ATS a la vez, con API y webhooks, pero no conecta con Bumeran ni con Computrabajo. Sus integraciones declaradas son con Lever, Greenhouse y Ashby. — [getonbrd.com/plans](https://www.getonbrd.com/plans); [Ashby integration](https://www.getonbrd.com/help/how-to-configure-the-ashby-integration-with-get-on-board)

### Inferences
- Usar un ATS intermedio para traer postulaciones de Bumeran o Computrabajo a la plataforma propia solo funcionaría con Pandapé y su API a medida (Computrabajo), o con HiringRoom si confirma por escrito que trae postulantes y ofrece una salida de datos (Bumeran). Ninguno es gratuito ni publica sus precios.
- Encadenar un ATS de terceros con Zapier hacia la plataforma propia (Manatal o Zoho) sigue sin resolver lo principal: la vuelta de postulaciones desde Bumeran no está confirmada. Además, con Computrabajo seguiría vigente la cláusula sobre la base privada de CV.

### Gaps
- Talento Cloud y otros ATS regionales no se investigaron.
- No se confirmó, para ningún ATS de terceros, que las postulaciones de Bumeran entren automáticamente con su CV.
- No hay precios públicos de Pandapé ni de HiringRoom; los de Manatal no se leyeron.

## 5. Correos de aviso de postulación con CV adjunto o enlace: qué envían los portales y si sus condiciones lo prohíben

### Takeaway
Ningún portal investigado documenta públicamente si su correo de aviso trae el CV adjunto o solo un enlace. Esta investigación no cambia lo que ya está en `docs/opcion-correos-de-aviso.md`: se averigua con una prueba real.

Novedad: Get on Board documenta controles de notificación por correo y en tiempo real, pero en su caso el webhook hace innecesario leer correos. HiringRoom añadió en 2025 un aviso por correo de «Solicitudes de Vacantes», que son pedidos internos de vacante y no postulaciones.

### Cited Findings
- [B] HiringRoom añadió *«una nueva notificación por correo para Solicitudes de Vacantes recibidas»* y opciones de postulación en Configuración de cuenta > Opciones de postulación. — [Novedades 2025 de HiringRoom](https://intercom.help/hiringroom/es/articles/13171955-potencia-tu-gestion-con-estas-novedades-2025)
- [B] Get on Board tiene actualizaciones de producto tituladas «Notificaciones en tiempo real para las empresas» y «Mucho mayor control sobre las notificaciones de e-mail». No se leyeron, así que no consta si el correo trae el CV. — [Notificaciones en tiempo real](https://www.getonbrd.com/product_updates/notificaciones-en-tiempo-real-para-las-empresas); [Control de notificaciones de e-mail](https://www.getonbrd.com/product_updates/mucho-mayor-control-sobre-las-notificaciones-de-e-mail)
- [B] No se encontró ninguna ayuda oficial de Bumeran ni de Computrabajo sobre el contenido de sus correos de aviso a empresas. — búsquedas del 28/10/2026
- [D] Condiciones relevantes para el correo de aviso:
  - Bumeran no regula los correos de aviso;
  - Computrabajo sí restringe guardar datos de candidatos fuera de sus herramientas, y eso alcanza también a los CV que lleguen por correo;
  - Trabajos Diarios limita el uso de los datos a fines de reclutamiento.

  — `docs/opcion-correos-de-aviso.md`

### Inferences
- Para el correo de aviso no hay nada que añadir desde fuentes públicas: la prueba real con cuentas de empresa sigue siendo el paso decisivo.
- Para Get on Board conviene priorizar el webhook sobre el correo, si se contrata el plan.

### Gaps
- No se sabe qué contiene el correo de aviso de Bumeran, Computrabajo, Trabajos Diarios, Get on Board ni Empleos Perú.

### Tabla resumen

| Portal | Mecanismo oficial | ¿Recibe el CV en sistema propio? | Requisitos | Costo | Cláusulas relevantes | Fuente y fecha de consulta |
|---|---|---|---|---|---|---|
| **Bumeran Perú** (Jobint) | Sin API pública ni programa de socios. Publicación desde ATS: HiringRoom (del grupo), Manatal o iSmartRecruit, con el contrato propio | **No confirmado.** Ninguna fuente dice que las postulaciones vuelvan al ATS; en HiringRoom el CV cuesta un crédito | Cuenta o contrato Bumeran y un ATS conectado | Avisos Talento gratuitos vía HiringRoom; el resto no es público | Prohíbe software para navegar o buscar distinto al de Bumeran y compartir la contraseña [D]; no regula correos ni bases de datos | [HiringRoom](https://intercom.help/hiringroom/es/articles/8386498-publicar-aviso-talento-select-bumeran-zonajobs-laborum-konzerta-multitrabajos) (artículo del 18/09/2023), [Manatal](https://www.manatal.com/integrations/my-contract-bumeran), [iSmartRecruit](https://www.ismartrecruit.com/integration/sponsored-job-board/bumeran); consulta 28/10/2026 |
| **Konzerta, Laborum, Multitrabajos** | Igual que Bumeran (publicación desde HiringRoom) | No confirmado | Contrato en Panamá, Chile o Ecuador | No público | No revisadas | [HiringRoom](https://intercom.help/hiringroom/es/articles/8386498-publicar-aviso-talento-select-bumeran-zonajobs-laborum-konzerta-multitrabajos); 28/10/2026 |
| **Aptitus** | Comprada por Navent y Bumeran en 2019; estado actual desconocido | Sin datos | — | — | — | [Gestión, 2019](https://gestion.pe/economia/empresas/navent-group-ltd-concreto-compra-de-clasificados-urbania-y-aptitus-del-grupo-el-comercio-noticia/) [S]; 28/10/2026 |
| **HiringRoom** (ATS de Jobint) | Publica en las marcas de Bumeran | No confirmado; sin API pública encontrada | Contrato con HiringRoom | Prueba gratuita; precio por orden de servicios | Términos de contratación no revisados en detalle | [Integraciones](https://hiringroom.com/integraciones), [Términos](https://hiringroom.com/hiringroom/terminos_y_condiciones) [B]; 28/10/2026 |
| **Computrabajo Perú** (DGNET) | Sin API para ATS ajenos. Única integración: Pandapé. Exportación de postulados en su panel (solo consta el título del artículo de ayuda) | Solo mediante Pandapé, otra herramienta «autorizada» o con autorización escrita | Autorización de DGNET | Publicación básica gratuita; el resto no se revisó | «En ningún caso, se otorga permiso… para constituir una base de datos privada de CVs… salvo… herramienta de software de reclutamiento ofrecida por el mismo y otras autorizadas o mediante autorización expresa por escrito»; «El acceso o lectura mediante robots o programas automáticos no está permitido» [D] | [avisolegal](https://pe.computrabajo.com/avisolegal/) (actualizado el 14/10/2026, leído el 27/10/2026); [soporte](https://soporte.computrabajo.com/hc/es/sections/15554639888530-Gesti%C3%B3n-de-candidatos) [B] 28/10/2026 |
| **Pandapé** (ATS de Redarbor) | Integración nativa con Computrabajo en «ALL PLANS»; API para integraciones a medida | Sí dentro de Pandapé. Hacia la plataforma propia, solo con una integración a medida, sin documentación pública | Contrato de 6 o 12 meses | Cotización a medida; sin precio público ni plan gratuito encontrado | Habría que confirmar en el contrato que la exportación a sistema propio está autorizada | [Soporte Pandapé](https://supportcenter.pandape.com/hc/en-us/articles/41246088775953) (24/11/2025) [V]; [planes](https://www.pandape.com/planes/) y [grandes empresas](https://www.pandape.com/en/large-enterprises/) [B]; 28/10/2026 |
| **Get on Board** | API pública (avisos) y privada (postulaciones); webhooks de nueva postulación y de retiro; exportación a CSV | **Sí, documentado** (webhook más API privada). Si incluye el enlace al CV está pendiente de confirmar | Plan Recruiter o superior según la ayuda (la página de planes también la lista en Growth y Scale) | Desde 500 USD/mes anual (Recruiter); 150 USD por aviso sin API | Condiciones no revisadas | [API](https://www.getonbrd.com/user-manual/get-on-board-s-api), [ayuda de API](https://www.getonbrd.com/help/what-can-i-do-with-get-on-board-s-api), [webhooks](https://www.getonbrd.com/help/what-webhook-events-does-get-on-board-send), [planes](https://www.getonbrd.com/plans) [V]; 28/10/2026 |
| **Trabajos Diarios** | Ninguno encontrado | No | — | — | No menciona robots; datos solo para reclutamiento [D] | [Términos](https://pe.trabajosdiarios.com/terminos-condiciones) (27/10/2026) |
| **Empleos Perú (MTPE)** | Publicación gratuita e ilimitada; sin API ni feed | No (manual) | Registro con RUC | Gratuito | No se encontraron condiciones para empleadores | [La República, 2022](https://larepublica.pe/datos-lr/2022/09/06/mtpe-lanza-nueva-bolsa-de-trabajo-para-promover-mas-de-140-mil-puestos-laborales) [S]; 28/10/2026 |
| **Certificado Único Laboral** (CERTIJOVEN y CERTIADULTO) | No es una bolsa: es un certificado que el empleador verifica en línea con el número y el DNI | No aplica | — | Gratuito | Ley N.° 31760 | [gob.pe](https://www.gob.pe/23661-verificar-certificado-unico-laboral) [B]; 28/10/2026 |
| **Trabajando.com y Universia** | Ninguno encontrado para Perú | No confirmado | — | — | No revisadas | [Universidad de Burgos](https://www.ubu.es/node/38368) [S]; 28/10/2026 |
| **Bolsas universitarias** (UNAC, UP y otras) | Registro de la empresa y publicación manual; sin API | No | Registro en cada universidad | Generalmente sin información | No revisadas | [UNAC](https://unac.edu.pe/wp-content/uploads/documentos/osg/Procedimientos/GUIA-DE-ACCESO-DE-BOLSA-DE-TRABAJO-UNAC---EMPRESAS.pdf), [UP](https://www.up.edu.pe/bolsadetrabajo/docs_/bolsa-de-trabajo-manual-de-uso.pdf) [B]; 28/10/2026 |
| **Bizneo y Zoho Recruit** | Multiposting y API propia, sin integración declarada con Bumeran ni Computrabajo | No para estos portales | Contrato | No revisado | — | [Bizneo](https://www.bizneo.com/en/recruiting-software-applicant-tracking-system), [Zoho](https://www.zoho.com/recruit/easy-integrations.html) [B]; 28/10/2026 |
| **Extractores de Computrabajo en Apify** | **PROHIBIDOS** | — | — | — | «El acceso o lectura mediante robots o programas automáticos no está permitido» | [Apify](https://apify.com/hernan_restrepo/computrabajo-jobs-scraper.md) [B]; 28/10/2026 |
