# Repos de código abierto, estándares y vías técnicas para conectar la plataforma con portales de empleo

Notas del investigador. Todas las fuentes se consultaron el **28/10/2026**, salvo que se indique otra fecha. Las cláusulas de LinkedIn, Bumeran y Computrabajo vienen de `docs/opcion-robot.md` y `docs/opcion-correos-de-aviso.md`, que las leyeron directamente el 27/10/2026. Hoy no se volvieron a abrir.

**Limitación de método:** la API de GitHub (`api.github.com`) estaba bloqueada para la herramienta de consulta. Por eso las estrellas se leyeron de la página HTML de cada repo, donde aparecen redondeadas (por ejemplo, "4.6k"). La fecha del último commit solo se obtuvo cuando la página de commits o PyPI la mostraban. Tampoco se pudo hacer una búsqueda dentro de GitHub: los repos se localizaron con un buscador web y después se abrieron uno por uno.

**Clasificación usada en estas notas:**
- **OFICIAL:** lo publica o documenta el propio portal o el dueño del estándar.
- **LEGÍTIMO:** herramienta de terceros o de código abierto que no accede al portal de forma automatizada ni infringe sus condiciones.
- **PROHIBIDO:** hace scraping, usa endpoints internos o automatiza una cuenta, en contra de las condiciones del portal.

---

## 1. ATS de código abierto: ¿qué conectores con portales traen?

### Takeaway
Ningún ATS de código abierto revisado trae conectores con Bumeran, Computrabajo ni otros portales latinoamericanos. Tampoco ingieren postulantes desde LinkedIn o Indeed por API. Lo que sí traen son cuatro patrones, todos ya presentes o fáciles de añadir en la plataforma:
- página pública de empleos;
- feed XML de salida;
- lectura de correos de aviso con una regla por portal (Odoo);
- enlaces de postulación etiquetados por portal (Frappe HR).

La única publicación directa encontrada es la de Odoo con Monster.com.

### Cited Findings
**OpenCATS**
- Se describe como "Open-source applicant tracking system (ATS) and recruitment CRM for staffing agencies and hiring teams". Muestra 772 estrellas y su sección de *Releases* está vacía — [GitHub opencats/OpenCATS](https://github.com/opencats/OpenCATS).
- **Mantenimiento activo.** Commits más recientes en `master`: 22/10/2026 "Bump OpenCATS version to 0.12.0" y "Update PHP test images to 8.4.27 and 8.5.12"; 21/10/2026 "feat: support ISO 8601 (YYYY-MM-DD) date format (#876)" — [commits de OpenCATS](https://github.com/opencats/OpenCATS/commits/master).
- **Licencia:** el código de OpenCATS está bajo "Mozilla Public License Version 2.0". El código original del proyecto CATS (hacia 2007) está bajo "CATS Public License Version 1.1a", una MPL modificada — [LICENSE.md](https://github.com/opencats/OpenCATS/blob/master/LICENSE.md).
- **Feed XML de salida:** la carpeta de plantillas contiene exactamente `indeed.xtpl`, `rss.xtpl` y `simplyhired.xtpl` — [modules/xml/xml_templates](https://github.com/opencats/OpenCATS/tree/master/modules/xml/xml_templates).
- Según el foro oficial, el feed se sirve en `/xml`, se elige la plantilla con `?t=` y la de Indeed es la predeterminada. Para otro portal hay que crear una plantilla nueva en `/modules/xml/xml_templates`. Solo aparecen las vacantes marcadas como "public", y la instalación debe ser accesible desde internet — [foro OpenCATS](https://forums.opencats.org/viewtopic.php?p=3971). Esta fuente llegó a través del resumen de un buscador y se apoya en hilos antiguos; la existencia de las plantillas sí está verificada en GitHub.
- **Sin conectores de entrada:** el README no menciona Indeed, LinkedIn, multiposting ni feeds de entrada. El repo tiene una carpeta `careers` (página pública) — [GitHub opencats/OpenCATS](https://github.com/opencats/OpenCATS).

**CandidATS**
- ATS en PHP y MySQL, publicado en SourceForge con licencias "GNU General Public License v3.0, Mozilla Public License 1.1, and Mozilla Public License 2.0".
- Última actualización: 10/08/2022. La descarga vigente es "CandidATS 3.0.0 - Stable.zip".
- No menciona integración con Indeed, LinkedIn, feeds XML ni página de empleos; LinkedIn solo aparece como botón para compartir — [SourceForge candidats](https://sourceforge.net/projects/candidats/).

**Odoo 19 (Recruitment)**
- **Publicación directa solo en Monster:** *"Currently, Odoo only supports directly posting to Monster.com."* Se configura con usuario y contraseña de Monster en Recruitment ‣ Configuration ‣ Settings. El método de postulación puede ser por correo o redirigiendo al sitio propio — [Odoo 19, Post job positions](https://www.odoo.com/documentation/19.0/applications/hr/recruitment/post_job.html).
- **Lectura de correos de aviso:** *"Three emails come preconfigured in the database: LinkedIn, Jobsdb, and Indeed."* *"When Odoo receives an email from the job board's corresponding email address, it runs the regex rule and pulls applicant information from the email when creating an applicant record."* El ejemplo de LinkedIn captura "everything after the word `from`". Para añadir otro portal: *"navigate to Recruitment app ‣ Configuration ‣ Emails"*, indicando el nombre, el remitente y la regla regex. La página no dice si conserva el CV adjunto — [misma página](https://www.odoo.com/documentation/19.0/applications/hr/recruitment/post_job.html).
- **Licencia:** el módulo `hr_recruitment` declara `'license': 'LGPL-3'` — [__manifest__.py, rama 19.0](https://github.com/odoo/odoo/blob/19.0/addons/hr_recruitment/__manifest__.py).
- La ruta `addons/hr_recruitment_integration_monster` devuelve 404 en el repo Community `odoo/odoo` (rama 19.0) — [GitHub](https://github.com/odoo/odoo/tree/19.0/addons/hr_recruitment_integration_monster).
- Un proveedor comercial (Ecosire) vende un conector de multiposting para Odoo; no se abrió su página — [ecosire.com](https://ecosire.com/de/apps/odoo/odoo-job-board-multiposting).

**Frappe HR / ERPNext**
- Descripción "Open Source HR and Payroll Software", licencia GPL-3.0, unas 9.0k estrellas. El README no menciona conectores con portales — [GitHub frappe/hrms](https://github.com/frappe/hrms).
- La ayuda oficial *"How do I post Job Openings to LinkedIn or Indeed?"* indica que Frappe HR no tiene conector con LinkedIn, Indeed, Naukri ni otros portales. Recomienda:
  1. publicar la vacante en el sitio propio ("Publish on website"; el portal queda en `/jobs`);
  2. crear un enlace al formulario de postulación por cada portal, con el parámetro `source` (por ejemplo `source=LinkedIn`);
  3. publicar a mano en el portal, eligiendo la opción de enviar a los candidatos a un sitio externo;
  4. filtrar a los postulantes por origen.

  [docs.frappe.io](https://docs.frappe.io/hr/recruitment/help-articles/how-do-i-post-job-openings-to-linkedin-or-indeed). Se obtuvo vía buscador; la URL es de la documentación oficial.

**Twenty**
- Es un CRM, no un ATS: "The open alternative to Salesforce, designed for AI", unas 60.0k estrellas. No menciona reclutamiento ni portales de empleo — [GitHub twentyhq/twenty](https://github.com/twentyhq/twenty).
- Licencia AGPLv3, salvo los archivos marcados `/* @license Enterprise */`, que tienen licencia comercial — [LICENSE](https://github.com/twentyhq/twenty/blob/main/LICENSE).

**OrangeHRM**
- Una entrada de su blog dice que la versión 7.14 trae un RSS de reclutamiento mejorado, con más datos de cada vacante — [blog OrangeHRM](https://orangehrmlive.com/resources/blog/the-future-of-hr-with-orangehrm-version-7-14). Se obtuvo vía buscador; la página no se abrió.

### Inferences
- **No existe un "repo conector" para los portales peruanos.** Los ATS libres maduros se conectan con los portales por cuatro vías, ninguna con API privada: página pública de empleos, feed XML de salida, lectura de correos de aviso y enlaces de postulación etiquetados por origen.
- La plataforma ya tiene las dos primeras (páginas con JobPosting y feed XML) y además un receptor Talent Apply, que ninguno de estos ATS trae.
- **Odoo confirma que la Opción A es un patrón establecido.** Que un ERP de gran difusión lea los avisos de LinkedIn e Indeed con reglas regex es un precedente técnico. Que su documentación solo hable de extraer el nombre (no el CV) es un indicio, débil, de que esos correos quizá no adjunten el CV. Coincide con lo que estima el usuario, pero no lo verifica.
- **Enlaces etiquetados por portal (patrón de Frappe):** son la vía gratuita más directa para LinkedIn (publicación gratuita), Bumeran, Computrabajo o Trabajos Diarios, si el portal permite postular en un sitio externo. Bastaría añadir `?source=<portal>` al enlace del formulario público y guardarlo como origen. Talent.com recomienda un token parecido (ver la sección 3). Si cada portal admite enlaces externos le toca verificarlo al investigador de portales.
- OpenCATS sirve como referencia de plantillas (Indeed, SimplyHired, RSS), no como dependencia: está en PHP y la plataforma es Next.js.

### Gaps
- No se verificó si el conector de Monster de Odoo es solo para la edición Enterprise. La ruta no existe en el repo Community, pero el módulo podría tener otro nombre.
- No se verificó si las reglas de correo de Odoo guardan el CV adjunto.
- No se abrió la documentación de OrangeHRM ni se confirmó su licencia actual.
- No se encontró ningún ATS de código abierto con conector para Bumeran, Computrabajo, Trabajos Diarios u otros portales latinoamericanos. La búsqueda web no devolvió ninguno; no se pudo buscar dentro de GitHub (ver la limitación de método).

---

## 2. Repos de GitHub que "conectan" con LinkedIn, Indeed, Bumeran o Computrabajo

### Takeaway
Todos los repos populares que dicen "conectar" con LinkedIn o Indeed son scrapers o clientes de la API interna. Están **PROHIBIDOS** por las condiciones de esos portales. Para Bumeran y Computrabajo solo aparecieron "actores" de pago en Apify, también scrapers y también **PROHIBIDOS**. Además, casi todos extraen avisos públicos, no los postulantes de la cuenta de empresa, así que tampoco resolverían la necesidad de recibir CV.

### Cited Findings
**speedyapply/JobSpy**
- Se describe como "Jobs scraper library for LinkedIn, Indeed, Glassdoor, ZipRecruiter, Bayt, Naukri, BDJobs & HelloWork". Licencia MIT, unas 4.6k estrellas. Usa la palabra "scraper" en todo el README, por ejemplo: "Indeed is the best scraper currently with no rate limiting". No menciona APIs oficiales — [GitHub speedyapply/JobSpy](https://github.com/speedyapply/JobSpy).
- Su paquete `python-jobspy` está en la versión 1.4.1, publicada el 23/10/2026, con licencia MIT — [PyPI](https://pypi.org/project/python-jobspy/).

**tomquirk/linkedin-api**
- Versión 2.3.1, publicada el 07/11/2024, licencia MIT.
- Funcionamiento: usa "Voyager", el servicio interno del sitio de LinkedIn. Se autentica con una cookie obtenida enviando usuario y contraseña de una cuenta de LinkedIn.
- Advertencias del propio proyecto: *"This library is not officially supported by LinkedIn"*, *"Using this library might violate LinkedIn's Terms of Service"* y *"an unofficial library intended for educational purposes and personal use only"* — [PyPI linkedin-api](https://pypi.org/project/linkedin-api/).
- Su repo de GitHub, https://github.com/tomquirk/linkedin-api, devolvió **HTTP 404** el 28/10/2026. Se desconoce la causa: puede haberse borrado, hecho privado o retirado.

**joeyism/linkedin_scraper**
- "A library that scrapes Linkedin for user data", unas 4.6k estrellas. Usa Playwright desde la v3.0.0 (antes Selenium).
- Exige iniciar sesión: *"LinkedIn requires authentication"*, mediante las variables `LINKEDIN_EMAIL` y `LINKEDIN_PASSWORD` o un archivo de sesión.
- Licencia contradictoria: la barra lateral dice GPL-3.0 y el README dice Apache 2.0 — [GitHub joeyism/linkedin_scraper](https://github.com/joeyism/linkedin_scraper).

**spinlud/linkedin-jobs-scraper**
- *"Scrape public available jobs on Linkedin using a headless browser"*. Licencia MIT, 189 estrellas.
- Usa Puppeteer con Chromium y, como alternativa, la cookie de sesión `li_at` o el par `li_rm`/`bcookie`.
- Su advertencia: *"For personal or educational use only"* — [GitHub spinlud/linkedin-jobs-scraper](https://github.com/spinlud/linkedin-jobs-scraper).

**Bumeran y Computrabajo**
- La búsqueda no encontró repos en GitHub. Solo aparecieron actores alojados en Apify Store, que no son código abierto:
  - [Computrabajo LATAM Jobs Scraper](https://apify.com/curable_quintal/computrabajo-latam-jobs), unos 10 países;
  - [Computrabajo.com Job Scraper](https://apify.com/unfenced-group/computrabajo-com-job-scraper), 16 países;
  - [Computrabajo Scraper](https://apify.com/scrapers_lat/computrabajo-scraper), 19 países;
  - [Bumeran Scraper](https://apify.com/blackfalcondata/bumeran-scraper?fpr=ewv9tm), que incluye Perú, Laborum, Multitrabajos y Konzerta;
  - [Bumeran Jobs Search Scraper](https://apify.com/alexist/bumeran-jobs-search-scraper.md).

  Los datos de países vienen del resumen del buscador; las páginas no se abrieron.

**Cláusulas que los prohíben**
- **LinkedIn**, Service Terms, sec. 1.5 (vigentes desde el 06/08/2026): *"Except as expressly authorized by LinkedIn in writing, use any automated means or form of scraping or data extraction to access, modify, download, query"*. El Acuerdo de Usuario, sec. 8.2, prohíbe *"use or attempt to use another's account (such as sharing log-in credentials or copying cookies)"* — [Service Terms](https://www.linkedin.com/legal/l/service-terms), [User Agreement](https://www.linkedin.com/legal/user-agreement). Citadas en `docs/opcion-robot.md` y verificadas el 27/10/2026.
- **Indeed**, Términos (Last Updated: 29/09/2026), sección 21 "Site Rules":
  - *"Access the Site through any means other than the public interfaces provided by Indeed"*;
  - *"Access any data, especially personal data, by automated means or otherwise, without permission"*;
  - *"Use any automated system (bots, scrapers, spiders, AI or Agentic AI) to access, data-mine, or submit content to the Site"*;
  - *"You may not crawl, scrape, extract data from, reproduce, duplicate, copy"*;
  - *"Modify, adapt, translate, reformat, resell, frame, or reverse engineer any portion of the Site"*;
  - *"Submit job applications or other User Content by automated means, in bulk or otherwise"*.

  La sec. A.3.5 añade: *"Use of any automation, scripting, or bots to automate the Indeed Apply process"* … *"outside of Indeed's official vendors and tooling is prohibited."* La sec. D.7.2 sanciona permitir que *"any other person or automated system to access or use your account"* — [indeed.com/legal](https://www.indeed.com/legal).
- **Bumeran Perú:** *«El uso o intento de uso de cualquier máquina, software, herramienta, agente u otro mecanismo para navegar o buscar en el Sitio Web que sean distintos a las herramientas de búsqueda provistos por BUMERAN»* y *«Revelar o compartir su contraseña con terceras personas»* — Términos y Condiciones de Uso de Perú (08/07/2024), en bumeran.com.pe/terminos-y-condiciones. Citado en `docs/opcion-robot.md`.
- **Computrabajo Perú:** *«El acceso o lectura mediante robots o programas automáticos no está permitido»* y *«No utilizar mecanismos, software o scripts en relación con la utilización del Sitio Web»* — [pe.computrabajo.com/avisolegal](https://pe.computrabajo.com/avisolegal/) (14/10/2026). Citado en `docs/opcion-robot.md`.

### Inferences
- **La popularidad no los legitima.** JobSpy (unas 4.6k estrellas, versión del 23/10/2026) y linkedin_scraper (unas 4.6k) son populares y se mantienen, pero sus métodos coinciden literalmente con lo que prohíben la sec. 21 de Indeed y la sec. 1.5 de LinkedIn.
- La desaparición del repo de linkedin-api en GitHub (404), con PyPI sin versiones nuevas desde noviembre de 2024, sugiere que estas bibliotecas son inestables, además de prohibidas. La causa no está verificada.
- **No sirven para el problema real.** JobSpy y los actores de Apify extraen **avisos publicados** (de cualquier empresa), no los **postulantes** que recibe la cuenta de la empresa. Ni siquiera ignorando las condiciones resolverían la recepción de CV.

### Gaps
- No se pudo buscar dentro de GitHub "bumeran" o "computrabajo"; puede haber repos pequeños de scraping que no salieron en el buscador web. Si existen, les aplican las mismas cláusulas.
- No se verificó la licencia real de linkedin_scraper; la página muestra dos licencias distintas.
- No se abrieron las condiciones de Apify ni de cada actor.

---

## 3. Estándares y formatos de feed: HR Open, schema.org JobPosting/directApply, Indeed, Talent.com, Jooble, LinkedIn

### Takeaway
Los formatos útiles son oficiales y están documentados:
- schema.org JobPosting con las reglas de Google, incluido `directApply`;
- XML de Indeed (Job Sync);
- XML de Talent.com con Talent Apply;
- XML de LinkedIn.

Todos usan una raíz `<source>` con elementos `<job>` y campos casi idénticos, así que un solo generador propio los cubre. No se encontró ninguna biblioteca npm que genere los feeds de Indeed, Talent.com o Jooble. Para JSON-LD, la documentación de Next.js 16 recomienda `schema-dts`. HR Open Standards es gratuito, pero no se encontró que los portales lo pidan.

### Cited Findings
**schema.org y Google**
- **schema.org `directApply`:** *"Indicates whether an url that is associated with a JobPosting enables direct application for the job"*. Es de tipo Boolean, se usa en JobPosting y está en el área "new". Versión de schema.org V30.1, del 16/09/2026 — [schema.org/directApply](https://schema.org/directApply).
- **Google, datos estructurados JobPosting** (Last updated 08/09/2026):
  - Propiedades obligatorias: `datePosted`, `description`, `hiringOrganization`, `jobLocation` y `title`.
  - Sobre `directApply`: si el usuario debe *"click apply, complete an application form, sign in or log in more than once"*, no cuenta como postulación directa. Ejemplo válido: *"The user completes the application process on your site."*
  - Sobre indexación: *"For job posting URLs, we recommend using the Indexing API instead of sitemaps"*.
  - Para trabajos 100 % remotos son obligatorios `applicantLocationRequirements` y `jobLocationType`.

  [Google Search Central](https://developers.google.com/search/docs/appearance/structured-data/job-posting).
- **Google Indexing API:** cuota diaria de publicación predeterminada de 200 (`URL_UPDATED`/`URL_DELETED`) por proyecto y 380 por minuto para todos los endpoints. *"All use of the Indexing API is available without payment."* Last updated 16/10/2026 — [Indexing API, cuotas](https://developers.google.com/search/apis/indexing-api/v3/quota-pricing).

**Feed XML de Indeed (Job Sync XML)** (Last updated 02/10/2026)
- Raíz `<source>` con elementos `<job>`.
- Obligatorios: `<title>`, `<date>`, `<referencenumber>`, `<requisitionid>`, `<url>`, `<company>`, `<city>`, `<state>`, `<country>`, `<email>`, `<description>`.
- Obligatorios si figuran en la página de empleos: `<postalcode>`, `<streetaddress>`, `<salary>`, `<education>`, `<jobtype>`, `<experience>`, `<expirationdate>`.
- Indeed lee el feed rastreando una URL, un FTP o SFTP del cliente, o un FTP de Indeed.
- Indeed Apply se declara con `<indeed-apply-data>` y aplica a toda la cuenta: *"Clients can opt out of Indeed Apply at the account level, but not at the job level."*

[docs.indeed.com](https://docs.indeed.com/job-sync-xml/xml-feed). Según el resumen del buscador, Indeed no acepta feeds incompletos ni "partial job opt-in" — [XML feed reference](https://docs.indeed.com/sponsored-jobs-api/shared-resources/xml-job-feed-format); ese dato no se abrió directamente.

**Feed XML de Talent.com**
- Obligatorios: `<referencenumber>`, `<title>`, `<company>`, `<city>`, `<state>`, `<country>`, `<dateposted>`, `<url>`, `<description>`.
- Opcionales: `<expirationdate>`, `<jobtype>`, `<isremote>`, `<salary>`, `<cpc>`, entre otros.
- Se entrega como URL o FTP, que Talent.com rastrea.
- Talent Apply se añade con `<talent-apply-data>`. Requisitos: *"Attributes must be URL encoded."*, *"All fields must be filled."*, *"Data attributes must include the prefix talent-apply-"*; `posturl` es obligatorio.
- La página no dice si la publicación por feed es gratuita.

[talent.com/integrations](https://www.talent.com/integrations). Según el resumen del buscador, la misma guía recomienda incluir un token como `source=talent` en la URL para medir los clics — [talent.com/integrations](https://www.talent.com/integrations).

**Feed XML de LinkedIn** (ms.date 20/10/2026)
- Campos obligatorios: `partnerJobId` (máximo 40 caracteres), `title`, `description` (mínimo 100 caracteres), `applyUrl` ("URL starting with https://www"), `location` o `city`/`state`/`country`, `posterEmail` y `companyId` ("Mandatory for Applicant Tracking Systems").
- *"LinkedIn only accepts jobs that are directly posted by employers on your platform"*.
- Máximo de 500 000 avisos por feed.
- No admite entidades HTML escapadas; el HTML va en CDATA.

[Microsoft Learn, LinkedIn XML Feeds Development Guide](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds-development-guide).

**Jooble**
- No se encontró la especificación oficial.
- Existe un plugin de WordPress, `wpjm-jooble-feed`, que genera un feed para Jooble. Según su FAQ, el formato de Jooble no usa los elementos RSS estándar. El plugin no se ha probado con las tres últimas versiones de WordPress — [wordpress.org](https://wordpress.org/plugins/wpjm-jooble-feed/). Se obtuvo vía buscador.

**HR Open Standards (antes HR-XML)**
- Consorcio sin fines de lucro fundado en 1999: *"Our voluntary consensus standards are free."* La portada no indica la versión vigente ni los esquemas de reclutamiento — [hropenstandards.org](https://www.hropenstandards.org/).
- La página `/download-the-standards` devolvió 404.
- Según el buscador, los esquemas principales de reclutamiento son PositionOpening y Candidate (presentación de 2019), y la versión 4.3 se lanzó en 2021 — [presentación del grupo de reclutamiento](https://assets.noviams.com/novi-file-uploads/hropen/pdfs-and-documents/HR_Open_Introduction_Webinar_2019_SM-e02adb39.pdf), [nota sobre 4.3.0-rc2](https://ipsnews.net/business/2020/12/09/hr-open-standards-consortium-announces-4-3-0-rc2-candidate-release/). No se abrieron; confianza baja.

**Bibliotecas**
- **schema-dts:** "JSON-LD TypeScript types for Schema.org vocabulary". Apache-2.0, unas 1.3k estrellas. *"Note: This is not an officially supported Google product."* — [GitHub google/schema-dts](https://github.com/google/schema-dts).
- La guía de JSON-LD de Next.js instalada en el proyecto dice: "You can type your JSON-LD with TypeScript using community packages like [`schema-dts`]" — `C:\Users\Admin\Desktop\p1\node_modules\next\dist\docs\01-app\02-guides\json-ld.md`, línea 73 (lectura local).
- **Generadores de feed:** la búsqueda de un paquete npm que genere el feed de Indeed no encontró ninguno. Solo apareció una gema Ruby antigua, [railsware/indeed](https://github.com/railsware/indeed), y un módulo de Odoo 18 de terceros, [hr_indeed_job_feed](https://apps.odoo.com/apps/modules/18.0/hr_indeed_job_feed). Ninguno de los dos se abrió.

### Inferences
- **Un generador propio basta.** Los feeds de Indeed, Talent.com y LinkedIn comparten estructura (`<source>/<job>`, CDATA para la descripción, URL de postulación) y casi todos los campos. Un solo generador con un mapeo por portal los cubre, como hacen las plantillas `.xtpl` de OpenCATS.
- **Revisar el feed actual de la plataforma contra estas listas.** Campos que podrían faltar:
  - Indeed: `<requisitionid>` y `<email>`;
  - LinkedIn: `partnerJobId` de 40 caracteres como máximo, `companyId`, `posterEmail` y una descripción de 100 caracteres o más.

  Que el feed se publique es gratis. Que el portal lo acepte depende del programa de cada uno, que cubre otro investigador.
- **Indexing API.** La plataforma ya usa JobPosting; avisar a Google con la Indexing API es gratis (200 avisos al día) y Google lo recomienda para empleos.
- **directApply.** Marcar `directApply: true` solo es correcto si el formulario propio no exige iniciar sesión ni más de un clic para postular.
- **HR Open no aporta valor práctico aquí.** Ningún portal revisado pide HR-JSON o HR-XML para recibir avisos. Es una deducción a partir de las especificaciones de Indeed, Talent.com y LinkedIn, que usan sus propios XML.

### Gaps
- No se encontró la especificación oficial del feed de Jooble.
- No se verificó la versión vigente de HR Open Standards ni sus condiciones de descarga (la página dio 404).
- No se verificó si `schema-dts` incluye `JobPosting` con `directApply` en su versión actual. Es probable, porque cubre el vocabulario central, pero la página no lo confirma.
- Quién puede usar el feed de LinkedIn (si exige ser socio o cliente de pago) lo cubre otro investigador; la guía consultada no lo dice.

---

## 4. APIs unificadas de ATS (Merge, Kombo, Apideck, Unified.to, Finch)

### Takeaway
Estas APIs conectan **un producto SaaS con los ATS de sus clientes** (Greenhouse, Lever, etc.), o **un portal de empleo con los ATS de las empresas** (Kombo para portales). No conectan el ATS propio de una empresa con LinkedIn, Indeed, Bumeran o Computrabajo. Solo Merge tiene un plan gratuito (3 cuentas conectadas); las demás cuestan de 599 USD al mes en adelante o no publican precios. **No aplican a esta plataforma.**

### Cited Findings
- **Merge.dev.** Plan Launch: "Start for free" y "Link 3 production Linked Accounts for free". Professional y Enterprise: "Contract-based pricing". La página no menciona portales de empleo ni la publicación en ellos; el caso de uso más cercano es "Candidate sourcing" — [merge.dev/pricing](https://www.merge.dev/pricing).
- **Apideck.**
  - Launch cuesta 599 USD al mes con 1 categoría de API unificada.
  - Scale cuesta 1299 USD al mes con 3 categorías.
  - Enterprise tiene precio "Custom".
  - Hay una prueba de 30 días. ATS es una de las 12 categorías a elegir.
  - No menciona portales de empleo.

  [apideck.com/pricing](https://www.apideck.com/pricing).
- **Unified.to.**
  - Grow: 750 USD o más al mes (750 000 llamadas).
  - Pro: 1500 USD o más al mes (2 000 000 de llamadas).
  - Scale: 3000 USD o más al mes.
  - Grow y Pro tienen prueba de 30 días; la página lista 168 integraciones ATS.

  [unified.to/pricing](https://unified.to/pricing). Según su blog, la función "Promote Jobs" publica en portales a través de los endpoints de los ATS compatibles, de modo que la cobertura depende de cada ATS — [blog Unified.to](https://unified.to/blog/best_unified_api_for_read_and_write_ats_integrations_2025), vía buscador.
- **Kombo.**
  - No publica precios: *"fixed annual platform fee"* más una tarifa por cliente, y *"Start with a free proof-of-concept before signing a contract"* — [kombo.dev/pricing](https://www.kombo.dev/pricing).
  - Su oferta para portales de empleo va en dirección contraria: el portal lee los avisos del ATS de cada empresa (*"Sync your customers' job feeds automatically, without having to subscribe to XML feeds"*) y devuelve las postulaciones a ese ATS (*"90+ ATS systems"*). El cliente es el portal — [kombo.dev/solutions/job-boards](https://www.kombo.dev/solutions/job-boards).

### Inferences
- **El modelo no encaja con la empresa.** Las APIs unificadas resuelven el problema de un **proveedor** que debe integrarse con muchos ATS de terceros. La empresa no tiene un ATS de terceros con el que conectarse: su ATS es la propia plataforma.
- **Lo que sí sirve es el modelo de Kombo, visto desde el otro lado.** Algunos portales prefieren leer un feed o API del ATS de la empresa. Exponer un feed XML bien formado, como ya hace la plataforma, es lo que le permite a un portal o agregador conectarse sin coste.
- No hay indicios de que alguna cubra Bumeran o Computrabajo. Es una deducción: ninguna de las páginas revisadas los menciona.

### Gaps
- No se verificó Finch, por presupuesto de consultas. Se le conoce como API de nóminas y RR. HH. (HRIS), pero hoy no se comprobó.
- No se revisaron los catálogos completos de integraciones de cada proveedor en busca de Bumeran o Computrabajo.
- El precio de Kombo no es público.

---

## 5. Correo entrante como vía legítima, y "Sign in with LinkedIn" / "Apply with Indeed"

### Takeaway
**Correo entrante.** Si la prueba real muestra que los avisos de algún portal traen el CV, hay servicios gratuitos que convierten un correo en webhook:
- Cloudflare Email Routing con Email Workers (gratis);
- Resend Inbound (gratis hasta 3000 correos al mes);
- Mailgun (gratis con 1 ruta).

Postmark exige un plan de 16,50 USD al mes y SendGrid retiró su plan gratuito en 2025. Para analizar el correo dentro de un Worker sirve `postal-mime` (MIT-0). **Riesgo:** si el correo solo trae un enlace al portal, seguirlo de forma automática es acceso automatizado, prohibido por LinkedIn, Indeed y Computrabajo. El enlace debe quedar para que lo abra una persona.

**Identificación.** "Sign in with LinkedIn" (OpenID Connect) solo entrega nombre, foto, idioma y correo; no da el CV ni la experiencia. Supabase Auth ya lo soporta con el proveedor `linkedin_oidc`. "Apply with Indeed" exige un contrato de desarrollador y la aprobación de Indeed, y no se encontraron bibliotecas de la comunidad para Next.js.

### Cited Findings
**Servicios de correo entrante**
- **Cloudflare Email Routing y Email Workers** (Last updated 25/09/2026):
  - límites: 200 reglas por dominio, 200 direcciones de destino por cuenta y mensajes de hasta 25 MiB;
  - *"Workers that handle incoming emails count toward the standard Workers CPU and memory limits"*;
  - *"On the Workers Free plan, complex handlers may exceed these limits and fail to process a message."*

  [Cloudflare, límites de Email Routing](https://developers.cloudflare.com/email-routing/limits/).
- **Workers, plan gratuito** (Last updated 12/10/2026): 100 000 solicitudes al día, 10 ms de CPU por invocación y 128 MB de memoria — [Cloudflare, límites de Workers](https://developers.cloudflare.com/workers/platform/limits/).
- **Postmark:**
  - Free: 0 USD, "100 emails/month", sin excedentes.
  - Basic: 15 USD al mes, sin procesamiento de entrada.
  - Pro: 16,50 USD al mes, con "Inbound email processing".
  - Platform: 18 USD al mes, también con procesamiento de entrada.

  [postmarkapp.com/pricing](https://postmarkapp.com/pricing).
- **Mailgun:**
  - Free: 0 USD, "100 emails/day", "1 custom sending domain" y "1 inbound route".
  - Basic: desde 15 USD al mes, con 5 rutas.
  - Foundation: 35 USD al mes tras un mes gratis, con "Full access to inbound routing".

  [mailgun.com/pricing](https://www.mailgun.com/pricing/).
- **SendGrid:** *"starting May 28, 2025, Twilio SendGrid will be retiring these free plans"*. Tras 60 días de transición se pausa el envío en las cuentas gratuitas — [Twilio changelog, 28/05/2025](https://www.twilio.com/en-us/changelog/changes-coming-to-sendgrid-s-free-plans). No se verificó en qué planes de pago está Inbound Parse.
- **Resend:** el plan Free incluye correo entrante (3000 correos al mes, 100 al día, 3 dominios). *"Each received email counts towards your transactional emails quota."* Pro cuesta 20 USD al mes — [resend.com/pricing](https://resend.com/pricing).
- **Cómo funciona Resend:**
  - el webhook `email.received` solo trae metadatos;
  - el cuerpo y los adjuntos se piden después con la API (`resend.emails.receiving.attachments.list({ emailId })`);
  - los correos se guardan aunque el endpoint esté caído y el envío se reintenta;
  - recomienda usar un subdominio, porque apuntar el dominio raíz enruta todo su correo a Resend.

  [Resend, recepción de correos](https://resend.com/docs/dashboard/receiving/introduction), [blog de Resend](https://resend.com/blog/inbound-emails). Se obtuvo vía buscador.

**Analizar el correo**
- **postal-mime:** "Email parser for browser and serverless environments". Licencia MIT No Attribution, 559 estrellas.
  - Funciona en Node.js 20 o superior, navegadores, Cloudflare Email Workers, Deno y Bun.
  - Devuelve un arreglo `attachments` con `filename`, `mimeType` y `content`.
  - Advierte que los valores no se sanean y que los nombres de los adjuntos deben tratarse como no confiables.

  [GitHub postalsys/postal-mime](https://github.com/postalsys/postal-mime).
- No se encontró ningún repo mantenido y específico para analizar los correos de aviso de los portales. El precedente de código abierto más cercano son las reglas regex por portal de Odoo 19 (sección 1). La búsqueda solo devolvió servicios comerciales (Zapier, CandidateZip, RChilli, Zoho Recruit) y un artículo sobre Postmark con un modelo de lenguaje — [DEV Community](https://dev.to/chengsokdara/ai-powered-hiring-from-inbox-chaos-to-structured-data-with-postmark-llm-59kf). El artículo no se abrió.

**Riesgo de seguir enlaces de forma automática**
- LinkedIn prohíbe *"any automated means … to access, modify, download, query"* — [Service Terms](https://www.linkedin.com/legal/l/service-terms).
- Indeed prohíbe *"Access any data, especially personal data, by automated means or otherwise, without permission"* — [indeed.com/legal](https://www.indeed.com/legal), sec. 21.
- Computrabajo dice *«El acceso o lectura mediante robots o programas automáticos no está permitido»* — [avisolegal](https://pe.computrabajo.com/avisolegal/).

**Sign in with LinkedIn (OpenID Connect)**
- Ámbitos: `openid`, `profile` ("lite profile including their id, name, and profile picture") y `email`.
- Datos devueltos: `sub`, `name`, `given_name`, `family_name`, `picture`, `locale`, `email` y `email_verified`. Los dos últimos son "Optional".
- Advertencia de LinkedIn: *"Sign In with LinkedIn using OpenID Connect does not verify user identities and should not be marketed as such."*
- Se activa pidiendo el producto "Sign in with LinkedIn using OpenID Connect" en el Developer Portal.

[Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2), actualizado el 08/08/2024.

**Bibliotecas para Next.js y Supabase**
- **Supabase Auth:**
  - `supabase.auth.signInWithOAuth({ provider: 'linkedin_oidc' })`;
  - requiere el producto "Sign In with LinkedIn using OpenID Connect";
  - el proveedor antiguo `linkedin` tenía su retiro programado para el 04/01/2024.

  [Supabase, Login with LinkedIn](https://supabase.com/docs/guides/auth/social-login/auth-linkedin).
- **Auth.js:** `import LinkedIn from "next-auth/providers/linkedin"`, variables `AUTH_LINKEDIN_ID` y `AUTH_LINKEDIN_SECRET`, callback `https://example.com/api/auth/callback/linkedin`. La página dice que Auth.js "is now part of" Better Auth — [authjs.dev](https://authjs.dev/getting-started/providers/linkedin).

**Indeed Apply para empleador directo** (Last updated 09/10/2026)
- Pasos: firmar un "Developer Agreement with Indeed", enviar la solicitud de integración y esperar la aprobación.
- Regla del solicitante único: *"Only the party building the integration can request and hold the API key or SFTP credentials."*
- Hay que *"publish an XML feed to Indeed on a regular schedule"*.
- Indeed envía cada postulación como JSON por POST HTTPS al `postUrl`, con el CV en Base64 (*"The `data` field contains the raw resume file in Base64 encoding"*), en formatos .txt, .pdf, .doc, .docx y .rtf.
- La página no menciona costes.

[docs.indeed.com](https://docs.indeed.com/indeed-apply/direct-employer).

### Inferences
- **Arquitectura propuesta, gratuita y compatible con el alojamiento actual (Vercel):**
  1. regla de reenvío en el buzón de RRHH hacia una dirección de un **subdominio** (por ejemplo `cv.<dominio>`);
  2. Cloudflare Email Worker o Resend Inbound;
  3. `postal-mime`;
  4. POST al endpoint de la plataforma, que reutiliza la carga masiva.

  Usar un subdominio evita tocar los registros MX del correo corporativo. Es una deducción basada en la recomendación de Resend.
- **Límite de CPU.** El plan gratuito de Workers (10 ms de CPU) puede no alcanzar para analizar correos con PDF grandes. Conviene que el Worker solo reenvíe el correo crudo, o sus adjuntos, a la plataforma, y que el análisis se haga en Vercel. Es una deducción a partir de la advertencia de Cloudflare.
- **Comparación con la Opción A ya diseñada** (Gmail API, Graph o IMAP): leer el buzón existente no necesita ningún servicio nuevo. El reenvío a un servicio de entrada es más simple de operar, pero:
  - añade un tercero que trata datos personales;
  - el reenvío puede romper SPF, de modo que la comprobación del remitente dependería sobre todo de DKIM.

  Es una deducción, no verificada.
- **Regla de diseño obligatoria:** si el correo solo trae un enlace al portal, la plataforma guarda el enlace y muestra un botón para que RRHH lo abra a mano. Nunca lo descarga en segundo plano.
- **Valor de "Sign in with LinkedIn".** Sirve para autocompletar el nombre, el correo y la foto en el formulario público, o para reducir el spam. No trae el CV, la experiencia ni el titular profesional, así que no sustituye la integración con LinkedIn. Además, si se exige iniciar sesión para postular, el aviso podría dejar de cumplir la definición de `directApply` de Google ("sign in or log in more than once").
- **Indeed Apply no es un "botón" que se pueda copiar.** Es una integración aprobada por Indeed y está atada al feed. La plataforma ya tiene un receptor equivalente para Talent Apply (JSON por POST), así que el código del receptor podría reutilizarse si Indeed aprueba a la empresa.

### Gaps
- No se verificó si Cloudflare Email Routing exige que el DNS del dominio o subdominio esté gestionado por Cloudflare.
- No se verificó si el plan Free de Postmark permite correo entrante.
- No se verificó en qué planes de SendGrid está Inbound Parse.
- No se verificó si el producto "Sign in with LinkedIn using OpenID Connect" tiene coste o requiere revisión.
- No se encontraron bibliotecas de la comunidad que implementen "Apply with Indeed" en Next.js.
- Sigue sin verificarse si los avisos de LinkedIn, Bumeran, Computrabajo o Trabajos Diarios adjuntan el CV; está pendiente de la prueba real descrita en `docs/opcion-correos-de-aviso.md`.

---

## 6. Inventario consolidado: ¿existe "un repo" para la conexión?

### Takeaway
**No existe un repo legítimo que conecte una plataforma propia con Bumeran o Computrabajo.** Los que dicen conectar con LinkedIn o Indeed son scrapers prohibidos. La conexión legítima no es un repo, sino un conjunto de **formatos oficiales** (JSON-LD, feeds XML de Indeed, Talent.com y LinkedIn, Indexing API, Talent Apply e Indeed Apply) más **patrones** de los ATS libres:
- enlaces de postulación etiquetados por portal (Frappe HR);
- lectura de correos de aviso con regex (Odoo);
- plantillas de feed (OpenCATS).

La plataforma ya implementa la mayoría.

### Cited Findings
Tabla de inventario, consultada el 28/10/2026. "Mantenimiento" indica el último dato verificable; "n/d" significa que la página no lo mostraba.

| Repo o herramienta | Qué hace | ¿API oficial o scraping? | Licencia | Mantenimiento (fecha) | ¿Aplicable a esta plataforma? | Clasificación | URL |
|---|---|---|---|---|---|---|---|
| OpenCATS | ATS en PHP con página de empleos y feed XML (`indeed`, `simplyhired`, `rss`) | Ni una ni otra: feed propio de salida | MPL-2.0 + CATS PL 1.1a | Último commit 22/10/2026 (versión 0.12.0) | Solo como referencia de plantillas (es PHP) | LEGÍTIMO | https://github.com/opencats/OpenCATS |
| CandidATS | ATS en PHP | Sin conectores | GPLv3 / MPL-1.1 / MPL-2.0 | Última actualización 10/08/2022 | No | LEGÍTIMO | https://sourceforge.net/projects/candidats/ |
| Odoo 19 Recruitment | ATS; publica en Monster con credenciales; lee avisos de LinkedIn, Jobsdb e Indeed con regex | Monster: integración documentada por Odoo (mecanismo interno no documentado); avisos: lectura de correo | LGPL-3 (`hr_recruitment`); módulo de Monster no hallado en el repo Community | Documentación 19.0 consultada el 28/10/2026 | El patrón de correo sí; Monster no | LEGÍTIMO | https://www.odoo.com/documentation/19.0/applications/hr/recruitment/post_job.html |
| Frappe HR | HR y ATS; página `/jobs` y enlaces de postulación con `source` por portal | Sin API: enlace externo publicado a mano | GPL-3.0 | Unas 9.0k estrellas; fecha n/d | El patrón de enlaces etiquetados sí | LEGÍTIMO | https://github.com/frappe/hrms · https://docs.frappe.io/hr/recruitment/help-articles/how-do-i-post-job-openings-to-linkedin-or-indeed |
| Twenty | CRM (no es ATS) | No aplica | AGPLv3 + archivos Enterprise | Unas 60.0k estrellas; fecha n/d | No | LEGÍTIMO (no aplica) | https://github.com/twentyhq/twenty |
| OrangeHRM | HR con RSS de vacantes (7.14) | Feed propio | No verificada | Blog de la versión 7.14, fecha n/d | Solo como referencia | LEGÍTIMO | https://orangehrmlive.com/resources/blog/the-future-of-hr-with-orangehrm-version-7-14 |
| schema.org JobPosting / `directApply` | Vocabulario de avisos | Estándar | No verificada | V30.1, 16/09/2026 | Sí (ya implementado) | OFICIAL (estándar) | https://schema.org/directApply |
| Google JobPosting + Indexing API | Aparición en Google; aviso de URL nuevas o cambiadas | API oficial y gratuita (200 avisos al día) | Condiciones de Google | Documentos actualizados el 08/09/2026 y el 16/10/2026 | Sí | OFICIAL | https://developers.google.com/search/docs/appearance/structured-data/job-posting · https://developers.google.com/search/apis/indexing-api/v3/quota-pricing |
| schema-dts | Tipos TypeScript para JSON-LD | Biblioteca | Apache-2.0 | Unas 1.3k estrellas; fecha n/d; recomendada por la documentación local de Next.js 16 | Sí | LEGÍTIMO | https://github.com/google/schema-dts |
| Indeed Job Sync XML | Formato del feed de avisos para Indeed | Oficial (feed) | Condiciones de Indeed | Actualizado el 02/10/2026 | Sí como formato; la aceptación depende de Indeed | OFICIAL | https://docs.indeed.com/job-sync-xml/xml-feed |
| Indeed Apply (empleador directo) | Postulación dentro de Indeed con CV en Base64 enviado al `postUrl` | API oficial; exige Developer Agreement y aprobación | Contrato con Indeed | Actualizado el 09/10/2026 | Solo si Indeed aprueba a la empresa | OFICIAL | https://docs.indeed.com/indeed-apply/direct-employer |
| Talent.com XML + Talent Apply | Feed de avisos y postulación por POST | Oficial | Condiciones de Talent.com | Fecha n/d | Sí (ya implementado) | OFICIAL | https://www.talent.com/integrations |
| LinkedIn XML feed | Formato del feed de avisos para LinkedIn | Oficial (elegibilidad no verificada aquí) | Condiciones de LinkedIn | ms.date 20/10/2026 | Solo si la empresa resulta elegible | OFICIAL | https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds-development-guide |
| HR Open Standards (HR-JSON / HR-XML) | Estándares de intercambio de datos de RR. HH. | Estándar | "Free" (términos exactos no verificados) | Sitio de 2026; versión 4.3 de 2021 (fuente secundaria) | Bajo: ningún portal revisado lo exige | OFICIAL (estándar) | https://www.hropenstandards.org/ |
| wpjm-jooble-feed | Plugin de WordPress que genera el feed de Jooble | Feed | No verificada | No probado con las 3 últimas versiones de WordPress | No (es WordPress); solo referencia | LEGÍTIMO | https://wordpress.org/plugins/wpjm-jooble-feed/ |
| Merge.dev | API unificada de ATS y RR. HH. para proveedores SaaS | API oficial de cada ATS | Propietaria; Launch gratis con 3 cuentas | Precios al 28/10/2026 | No (no conecta portales) | LEGÍTIMO (no aplica) | https://www.merge.dev/pricing |
| Apideck | API unificada (ATS entre 12 categorías) | API | Propietaria; desde 599 USD al mes | Precios al 28/10/2026 | No | LEGÍTIMO (no aplica) | https://www.apideck.com/pricing |
| Unified.to | API unificada (168 ATS) | API | Propietaria; desde 750 USD al mes | Precios al 28/10/2026 | No | LEGÍTIMO (no aplica) | https://unified.to/pricing |
| Kombo | API unificada; su oferta para portales conecta el portal con los ATS de las empresas | API | Propietaria; precio no público | Consultado el 28/10/2026 | No | LEGÍTIMO (no aplica) | https://www.kombo.dev/solutions/job-boards |
| Cloudflare Email Routing + Email Workers | Convierte un correo entrante en la ejecución de un Worker | Servicio de correo propio, no toca el portal | Propietario; gratis (Workers Free: 100 000 solicitudes al día, 10 ms de CPU) | Actualizado el 25/09/2026 | Sí, si los avisos traen el CV | LEGÍTIMO | https://developers.cloudflare.com/email-routing/limits/ |
| postal-mime | Analiza correos MIME y extrae adjuntos (también en Workers) | Biblioteca | MIT-0 | 559 estrellas; versión 4 (fecha n/d) | Sí | LEGÍTIMO | https://github.com/postalsys/postal-mime |
| Resend Inbound | Correo entrante a webhook; adjuntos por API | Servicio | Propietario; gratis hasta 3000 correos al mes | Precios al 28/10/2026 | Sí | LEGÍTIMO | https://resend.com/pricing |
| Mailgun Routes | Correo entrante a webhook | Servicio | Propietario; gratis con 1 ruta | Precios al 28/10/2026 | Sí | LEGÍTIMO | https://www.mailgun.com/pricing/ |
| Postmark Inbound | Correo entrante a webhook | Servicio | Propietario; desde 16,50 USD al mes (Pro) | Precios al 28/10/2026 | Sí, de pago | LEGÍTIMO | https://postmarkapp.com/pricing |
| SendGrid Inbound Parse | Correo entrante a webhook | Servicio | Propietario; plan gratuito retirado el 28/05/2025 | Changelog del 28/05/2025 | Poco interés (de pago) | LEGÍTIMO | https://www.twilio.com/en-us/changelog/changes-coming-to-sendgrid-s-free-plans |
| Supabase Auth `linkedin_oidc` | Inicio de sesión con LinkedIn (OIDC): nombre, foto, idioma y correo | API oficial de LinkedIn | Supabase (Apache-2.0, no verificado hoy) | Documentación consultada el 28/10/2026 | Sí, opcional (no trae el CV) | OFICIAL (LinkedIn) / LEGÍTIMO | https://supabase.com/docs/guides/auth/social-login/auth-linkedin |
| Auth.js, proveedor LinkedIn | Lo mismo con NextAuth | API oficial de LinkedIn | No verificada | Documentación consultada el 28/10/2026; Auth.js ahora es parte de Better Auth | Poco interés: la plataforma ya usa Supabase Auth | LEGÍTIMO | https://authjs.dev/getting-started/providers/linkedin |
| JobSpy (speedyapply) | Extrae avisos de LinkedIn, Indeed, Glassdoor, ZipRecruiter, etc. | **Scraping** | MIT | PyPI 1.4.1, 23/10/2026 | No | **PROHIBIDO** (LinkedIn Service Terms 1.5; Indeed sec. 21 "Site Rules") | https://github.com/speedyapply/JobSpy |
| linkedin-api (tomquirk) | Cliente de la API interna "Voyager" con cuenta y cookie | **API interna** | MIT | PyPI 2.3.1, 07/11/2024; el repo de GitHub da 404 el 28/10/2026 | No | **PROHIBIDO** (LinkedIn Service Terms 1.5; Acuerdo de Usuario 8.2) | https://pypi.org/project/linkedin-api/ |
| linkedin_scraper (joeyism) | Extrae perfiles, empresas y avisos con Playwright e inicio de sesión | **Scraping** | GPL-3.0 o Apache-2.0 (contradictorio) | Unas 4.6k estrellas; fecha n/d | No | **PROHIBIDO** (LinkedIn 1.5 y 8.2) | https://github.com/joeyism/linkedin_scraper |
| linkedin-jobs-scraper (spinlud) | Extrae avisos con Puppeteer y la cookie `li_at` | **Scraping** | MIT | 189 estrellas; fecha n/d | No | **PROHIBIDO** (LinkedIn 1.5 y 8.2) | https://github.com/spinlud/linkedin-jobs-scraper |
| Actores de Apify para Computrabajo y Bumeran | Extraen avisos de Computrabajo, Bumeran, Laborum, Konzerta, etc. | **Scraping** (alojado, de pago) | Propietaria | Consultado el 28/10/2026 | No | **PROHIBIDO** (Computrabajo: «acceso o lectura mediante robots…»; Bumeran: «uso … de cualquier máquina, software…») | https://apify.com/scrapers_lat/computrabajo-scraper · https://apify.com/blackfalcondata/bumeran-scraper?fpr=ewv9tm |

### Inferences
- **Respuesta directa al usuario:** el "repo" que se espera encontrar existe solo en forma de scrapers, y esos están prohibidos. Los ATS libres serios (Odoo, Frappe HR, OpenCATS) **tampoco tienen** conectores con Bumeran o Computrabajo. Se conectan con los portales igual que ya lo hace esta plataforma.
- **Mejoras gratuitas sugeridas por este inventario:**
  1. Enlaces de postulación etiquetados por portal (`?source=`) para publicar a mano en LinkedIn, Bumeran, Computrabajo y Trabajos Diarios con postulación en el sitio externo (patrón de Frappe HR y token de Talent.com).
  2. Ajustar el feed XML para cubrir los campos obligatorios de Indeed y de LinkedIn (sección 3).
  3. Avisar a Google con la Indexing API (gratis, 200 al día).
  4. Si la prueba real muestra que algún aviso trae el CV, recibirlo con Cloudflare Email Workers o Resend y `postal-mime`, siguiendo el precedente de Odoo, sin seguir enlaces de forma automática.
- **Prioridades de las mejoras:**
  - la 1 depende de que cada portal permita la postulación externa (lo verifica el investigador de portales);
  - la 2 depende de los programas de cada portal;
  - la 3 y la 4 no dependen de terceros, salvo la prueba real.

### Gaps
- Faltan las fechas de último commit de la mayoría de los repos (salvo OpenCATS y los paquetes de PyPI), porque la API de GitHub estaba bloqueada y las páginas no las mostraban.
- No se verificaron las licencias de OrangeHRM, schema.org, Auth.js ni Supabase.
- No se verificó la elegibilidad para el feed de LinkedIn ni para Indeed Apply desde Perú; lo cubre otro investigador.
