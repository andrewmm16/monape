# LinkedIn, Indeed, Google for Jobs y agregadores con presencia en Perú: vías oficiales para recibir postulaciones y CV en la plataforma propia

Todas las fuentes se consultaron el **28/10/2026**, salvo que se indique otra fecha. Etiquetas de fiabilidad:
- **[Oficial]**: página leída completa en el sitio del proveedor.
- **[Oficial, fragmento]**: página oficial vista solo como fragmento de un buscador, sin abrirla.
- **[Secundaria]**: blog o centro de ayuda de un proveedor ATS, o prensa. Sirve solo como apoyo.

Antecedentes que estas notas amplían: `docs/opcion-robot.md` y `docs/opcion-correos-de-aviso.md`, ambos del 27/10/2026.

## LinkedIn: estado en 2026 de Apply Connect, RSC, Job Posting API, Basic Jobs/Limited Listings y XML, programa de socios y "Sign In with LinkedIn (OIDC)"

### Takeaway
Todas las vías de LinkedIn que entregan postulaciones a un sistema externo están reservadas a socios aprobados con contrato:
- Apply Connect exige además una licencia de pago de LinkedIn Recruiter.
- Job Posting API y Apply with LinkedIn no aceptan socios nuevos.
- El feed XML de Basic Jobs/Limited Listings está pensado para ATS y portales con muchos clientes de pago.

Para una sola empresa con desarrollo propio no hay una vía gratuita de integración. Lo legítimo y gratuito es:
- publicar el aviso a mano en LinkedIn, con postulación en el sitio externo (el formulario propio);
- usar "Sign In with LinkedIn (OIDC)", que solo entrega nombre, correo, foto y locale, **sin experiencia ni educación**.

### Cited Findings
**Apply Connect** [Oficial]
- Es una integración entre un ATS y LinkedIn: "you, as a LinkedIn partner, can post jobs on LinkedIn on behalf of your customers, through your ATS, and receive all job applications directly into your ATS system" — [Apply Connect overview](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-overview) (ms.date 04/09/2026).
- Requisito: "Use a LinkedIn Recruiter Corporate license or LinkedIn Recruiter Professional Services license". La integración tiene 8 pasos y termina en una certificación ("Complete Apply Connect certification") — [misma página](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-overview).
- Componentes: APIs para enviar avisos con preguntas, "receive real-time job applications and skills match data", sincronizar estados con el postulante y dos widgets: Applicant Highlights y Full Profile — [misma página](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-overview).
- Cómo llegan las postulaciones — [Receive job applications](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/receive-applications) (ms.date 21/09/2026):
  - **Envío:** LinkedIn hace un POST JSON al `jobApplicationWebhookUrl` que se indica en cada aviso, con `type: EXPORT_JOB_APPLICATION`.
  - **Firma:** cabecera `X-LI-Signature`, HMAC-SHA256 con el client secret de la app y prefijo `hmacsha256=`.
  - **Validación del endpoint:** un desafío inicial y otro cada 2 horas. Si falla 3 veces seguidas, el endpoint se bloquea y el aviso pasa a postulación externa (`companyApplyUrl`).
  - **Reintentos:** hasta 6 si la respuesta no es 200.
  - **Contenido:** nombre, apellido y correo (siempre); celular y ubicación; CV y carta como `mediaUrl`; experiencia laboral, educación, preguntas propias, autoidentificación voluntaria y `applicantSkills`.
  - **Archivos:** los `mediaUrl` duran 30 días y se descargan con un token OAuth Bearer.
- La integración antigua de Easy Apply figura como "fully deprecated" — [Talent release notes](https://learn.microsoft.com/en-us/linkedin/talent/release-notes) [Oficial, fragmento; no abierto].

**Job Posting API** [Oficial]
- "We are currently not accepting new partnerships for LinkedIn's Job Posting API. If you would like to gain access to LinkedIn's Job Posting APIs please request access to Apply Connect" — [Job Posting API Overview](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview) (ms.date 09/06/2025, actualizada el 03/06/2026).
- "The use of these APIs is restricted to those developers approved by LinkedIn… sign an API agreement with data restrictions". A quien no es socio lo remite al [LinkedIn Talent Solutions Partner Request Form](https://business.linkedin.com/talent-solutions/ats-partners/partner-application) — [misma página](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview).
- El socio no puede presentarlo como "free way to post jobs to LinkedIn". LinkedIn "reserves the right to require promotion of jobs" — [misma página](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview).
- Hay dos categorías:
  - **Basic Jobs:** gratuitos, "receive limited active promotion".
  - **Promoted Jobs:** pagados, en Job Slots, y exigen `contractId`.

  La postulación dentro de LinkedIn solo existe si se es socio de Apply Connect — [misma página](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview).

**Basic Jobs (antes "Limited Listings") por feed XML** [Oficial]
- "The integration of the XML feed is limited to those developers approved by LinkedIn… sign an agreement". Quien no es socio escribe a LL-BD@linkedin.com — [Overview Job Posts using XML Feeds](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds) (ms.date 27/07/2021, actualizada el 18/06/2025).
- Para la evaluación hay que enviar:
  - "Average number of daily listings available on your platform";
  - los mercados;
  - la URL de la página de resultados de búsqueda.

  Es un perfil de **portal de empleo o ATS**, no de empleador individual — [misma página](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds).
- Integrarlo toma "typically 2 - 8 weeks". El feed se publica en una URL estática que LinkedIn descarga — [misma página](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds).
- Las directrices para terceros (ms.date 18/11/2025) — [Third-Party Job Listing Guidelines](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds-job-posting-guidelines):
  - aplican a "a third-party site sending jobs to LinkedIn on behalf of your customers";
  - "Access to LinkedIn integration should be restricted to verified, paying users of your system";
  - el botón de postular "should be immediately directed to the site where the application process is hosted". Es decir, el feed solo redirige; **no entrega postulaciones**.
  - "Beginning in August 2024, certain third-party jobs may no longer be visible on LinkedIn when they are ingested as Basic Jobs or Limited Listings".
- En diciembre de 2022 "Limited Listings" pasó a llamarse "Basic Jobs". El esquema XML exige además un correo del responsable de cada aviso — [Job Posting release notes](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/job-posting-release-notes) [Oficial, fragmento; no abierto].
- **Job Wrapping**, que copia los avisos del sitio de carreras, existe solo "For customers who purchased Job Slots", es decir, de pago — [XML Feeds overview](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds).

**Apply with LinkedIn (AWLI)** [Oficial]
- "we are currently not accepting any new partners for Apply with LinkedIn (AWLI)… actively working on the development of a new version" — [Apply with LinkedIn](https://learn.microsoft.com/en-us/linkedin/talent/apply-with-linkedin/apply-with-linkedin) (ms.date 04/09/2026).
- AWLI rellenaba en el sitio de carreras "name, contact information, location, employers, and education background". Es el único producto que daba experiencia y educación a un formulario propio, y **está cerrado a socios nuevos** — [misma página](https://learn.microsoft.com/en-us/linkedin/talent/apply-with-linkedin/apply-with-linkedin).

**Recruiter System Connect (RSC) y CRM Connect** [Oficial, solo la página índice]
- RSC "synchronizes customers' candidate information between your ATS and LinkedIn Recruiter". CRM Connect exporta perfiles de LinkedIn Recruiter a un CRM — [LinkedIn Talent Solutions overview](https://learn.microsoft.com/en-us/linkedin/talent/) (ms.date 04/09/2026).
- Ambos dependen de LinkedIn Recruiter, que es de pago, y no reciben postulaciones a avisos.

**Sign In with LinkedIn using OpenID Connect** [Oficial]
- Alcances: `openid`, `profile` ("id, name, and profile picture") y `email`. Se activa en el Developer Portal, en My Apps > Products, pidiendo el producto "Sign in with LinkedIn using OpenID Connect" — [Sign In with LinkedIn using OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) (ms.date 14/12/2022, actualizada el 08/08/2024).
- `GET https://api.linkedin.com/v2/userinfo` devuelve solo `sub`, `name`, `given_name`, `family_name`, `picture`, `locale`, `email` y `email_verified`. Los dos últimos son opcionales — [misma página](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).
- El documento de descubrimiento lista exactamente esos `claims_supported`, sin cargo, experiencia, educación ni habilidades — [openid-configuration](https://www.linkedin.com/oauth/.well-known/openid-configuration), citado en la misma página.
- Advertencia oficial: "does not verify user identities and should not be marketed as such" — [misma página](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).

**Publicación gratuita manual** (antecedente del 27/10/2026, no revisado de nuevo)
- La ayuda de LinkedIn sobre publicación gratuita menciona "Send email updates through LinkedIn or an external website". La publicación gratuita dura 14 días y se pausa al llegar a un límite de solicitudes, normalmente entre 10 y 30 — [LinkedIn Help a522384](https://www.linkedin.com/help/linkedin/answer/a522384), citado en `docs/opcion-correos-de-aviso.md`.

### Inferences
- Una empresa que no es proveedora de ATS no tiene acceso práctico a la recepción automática desde LinkedIn:
  - toda la documentación habla de un "partner" que actúa "on behalf of your customers";
  - Job Posting API y AWLI no aceptan socios nuevos;
  - el feed de Basic Jobs pide métricas de portal de empleo.

  La única puerta formal es el formulario de socios, con contrato, certificación y licencia Recruiter Corporate. No es gratis ni de bajo costo.
- Si algún día se tuviera Apply Connect, lo que habría que construir ya está especificado:
  - endpoint HTTPS que responda el desafío de validación;
  - verificación HMAC-SHA256 de `X-LI-Signature`;
  - descarga del CV desde `mediaUrl` con OAuth antes de 30 días;
  - respuestas de error tipificadas, como `DUPLICATE_APPLICATION_RECEIVED`.
- La vía gratuita y legítima es publicar el aviso en LinkedIn con postulación en el sitio externo, apuntando a la página pública de la vacante. El CV llega por el formulario propio. Esto depende de que la publicación gratuita permita el enlace externo en Perú, cosa que no se ha comprobado con una cuenta real.
- OIDC sirve para autocompletar nombre, correo y foto en el formulario propio y dejar constancia de que la persona inició sesión con LinkedIn. **No sustituye** la carga del CV ni trae experiencia.
- Esto **confirma y precisa** lo que dice `opcion-robot.md` sobre que Apply Connect "exige ser socio de LinkedIn y una licencia de pago": la licencia es Recruiter Corporate o Recruiter Professional Services.

### Gaps
- No se encontró el precio público de LinkedIn Recruiter Corporate. LinkedIn no lo publica en las páginas consultadas.
- No se abrió la página de requisitos de RSC; solo se leyó su descripción en la página índice.
- No se verificó si el producto OIDC tiene costo o cuotas. La página no lo dice, aunque está en la sección "self-serve".
- No se confirmó en una fuente de 2026 que la publicación gratuita de LinkedIn en Perú permita postular en el sitio externo.
- No se encontró si LinkedIn acepta como socio de Apply Connect a una empresa con ATS propio para su único uso. La documentación no lo prohíbe ni lo contempla.

## Indeed: Indeed Apply hacia un ATS propio, feed XML orgánico, Job Sync API y programa de socios

### Takeaway
Indeed sí documenta una vía para **empleadores directos con desarrollo propio**:
- **Indeed Apply** mediante el feed XML (o Job Sync API, abierta a empleadores directos desde el 31/07/2026);
- Indeed envía cada postulación como POST JSON firmado (HMAC-SHA1), con el CV en base64, a un `postUrl` HTTPS propio.

Para acceder hay que firmar un Developer Agreement y pasar una revisión de unas 6 semanas. La documentación no menciona precio.

En Perú, la publicación gratuita no tiene límite mensual y los avisos son visibles hasta 120 días. La nueva política de feeds de una sola fuente (31/03/2026) **exime a los sistemas propios**.

### Cited Findings
**Indeed Apply para empleador directo** [Oficial] — [Direct employer integration](https://docs.indeed.com/indeed-apply/direct-employer)
- **Ámbito:** es para "direct employers and third parties acting on their behalf". "Only the party building the integration can request and hold the API key or SFTP credentials". No se admiten solicitudes por encargo.
- **Credenciales fuera de Japón:**
  1. contactar a Indeed Client Success;
  2. firmar el Developer Agreement;
  3. Indeed crea la app;
  4. "Use the client ID and client secret as the API token credentials", e incluir ese token en cada aviso.

  El flujo se actualizó el 15/05/2026: "contact Indeed Client Success to register your interest", luego el Developer Agreement y luego Partner Console — [Release notes 2026](https://docs.indeed.com/release-notes/2026).
- **Envío de avisos:** un feed XML con `<indeed-apply-data>` en cada aviso, publicado de forma periódica (la página menciona FTP como ejemplo). La alternativa son las mutaciones `createSourcedJobPostings` y `updateSourcedJobPostings` de Job Sync. Los avisos creados por API hay que expirarlos explícitamente.
- **Recepción** por `indeed-apply-postUrl`:
  - HTTPS con certificado válido;
  - sin redirecciones 301 o 302;
  - responder 2XX si se recibió bien, 400 si falta un campo obligatorio y 401 si la firma falta o no es válida;
  - Indeed reintenta con espera exponencial y guarda las postulaciones no entregadas 60 días.
- **Formato:** JSON UTF-8 sin tamaño máximo, que conviene leer de forma tolerante. El CV va en base64 en .txt, .pdf, .doc, .docx o .rtf.
- **Firma:** "Indeed sends this signature in the X-Indeed-Signature header". Es HMAC-SHA1 del cuerpo sin alterar, calculado con el API secret. La referencia de generación de firmas trae ejemplos de código: [message-signature-generation](https://docs.indeed.com/indeed-apply/message-signature-generation).
- **Duplicados:** mismo ID de aviso y mismo correo en los últimos 120 días.
- **Preguntas de filtro:** JSON en una URL HTTPS, hasta 500 preguntas y menos de 1 MB. La conversión cae mucho con más de 20.
- **Plazo y costo:** "usually takes about six weeks" configurar, probar, revisar y desplegar. La página no menciona precio. La única diferencia por país que cita es el proceso de Japón.

**Cambios recientes que afectan a la integración** [Oficial]
- 31/07/2026: "The Job Sync API is now available to direct employers" — [Release notes 2026](https://docs.indeed.com/release-notes/2026).
- 15/06/2026: la referencia del feed XML pasó a la sección "Job Sync XML feed" y los enlaces antiguos redirigen allí — [misma fuente](https://docs.indeed.com/release-notes/2026).
- 30/06/2026: se retiró el campo `publicProfileUrl`; hay que usar los campos del objeto resume — [misma fuente](https://docs.indeed.com/release-notes/2026).
- El esquema 0.0 de preguntas de filtro dejó de funcionar el 08/12/2025. Las integraciones que siguen en 0.0 envían al postulante al sitio del empleador — [Release notes](https://docs.indeed.com/release-notes).
- `indeed-apply-resumefieldsrequired` "requests resume fields but does not guarantee them" (30/09/2026) — [Release notes](https://docs.indeed.com/release-notes).
- **Conflicto en la documentación de Indeed:** la portada de Indeed Apply todavía dice que las integraciones con Job Sync API son "for approved partners" — [Indeed Apply](https://docs.indeed.com/indeed-apply). La nota del 31/07/2026 dice que ya están abiertas a empleadores directos.
- La FAQ de Job Sync dice que tiene la misma funcionalidad que el feed XML de Indeed Apply y que conviene usarla en su lugar. Las credenciales son OAuth de 2 vías ("2-legged") — [Job Sync API FAQ](https://docs.indeed.com/job-sync-api/faq).

**Feed XML orgánico y sitio de carreras**
- **Política de feeds de una sola fuente, desde el 31/03/2026** [Oficial, publicada en el sitio de India] — [Single-Source Feed Policy](https://in.indeed.com/help/employers/articles/single-source-feed-policy-effective-march-31-2026):
  - los avisos de feeds de una sola fuente que puedan enviarse por un ATS integrado con Indeed "will no longer appear for free" y quedan "visible only when sponsored";
  - "Feeds from ATSs without an Indeed integration (for example, Taleo or homegrown systems) are not affected";
  - la página no indica su alcance por país.
- **Rastreo de sitios de carreras** [Secundaria, HR Dive, 31/03/2026]: Indeed dijo que seguirá rastreando los sitios de carreras públicos, y que los empleadores que no migren "will continue to receive organic traffic". El artículo no aclara si aplica fuera de EE. UU. — [HR Dive](https://www.hrdive.com/news/visibility-ends-for-certain-free-single-source-xml-feeds-on-indeed/816209/).
- **Agencias** [Secundaria, fragmento]: en junio de 2025 Indeed avisó que las agencias ya no podrían enviar avisos por XML — [College Recruiter, 19/06/2025](https://www.collegerecruiter.com/blog/2025/06/19/breaking-news-indeed-wont-accept-jobs-via-xml-ep106).
- **Publicación gratuita en Perú** [Oficial] — [Indeed Perú, límite de publicaciones gratuitas](https://pe.indeed.com/help/employers/articles/free-job-post-limit) (sin fecha; pie © 2026):
  - Perú está entre los países que "no tienen un límite de publicaciones de empleo gratuitas";
  - los avisos gratuitos "permanecen visibles hasta 120 días";
  - siguen sujetos a normas de calidad y límites de uso.

### Inferences
- La plataforma propia encaja en "direct employer" y "homegrown system". Es la vía oficial más prometedora de todo el estudio para recibir el CV automáticamente desde un portal grande.
- Habría que construir:
  1. ampliar el feed XML actual con `<indeed-apply-data>` (token y `postUrl`), o usar Job Sync API con OAuth;
  2. un endpoint HTTPS en Next.js/Vercel que verifique `X-Indeed-Signature` con HMAC-SHA1 sobre el cuerpo crudo, decodifique el CV en base64 y lo registre por la misma vía que la carga masiva;
  3. respuestas 2XX, 400 y 401, idempotencia por (ID de aviso, correo) y monitoreo.

  Esto se parece mucho al receptor de Talent Apply que ya existe.
- **Riesgo de la política de una sola fuente:** si al integrar Indeed Apply el sistema propio pasa a contar como "ATS with an Indeed integration", es posible que su feed deba ir por la vía integrada para seguir siendo orgánico. El texto no lo resuelve; hay que preguntárselo a Client Success.
- Mientras tanto, publicar a mano en Indeed Perú es gratuito y sin límite mensual. Si Indeed rastrea la página pública de la vacante, el postulante llega al formulario propio.

### Gaps
- No se encontró el costo de la integración directa. La documentación no lo menciona; hay que preguntárselo a Indeed Client Success.
- No se confirmó que Indeed Apply para empleador directo esté disponible para avisos de Perú. La documentación solo distingue Japón del resto.
- No se confirmó si la política de una sola fuente aplica en Perú. Se publicó en el sitio de India, sin alcance por país.
- No se confirmó si Indeed rastrea hoy sitios de carreras peruanos. La única fuente es secundaria y se refiere a EE. UU.
- No se encontró si la publicación gratuita manual en Indeed Perú permite que el postulante vaya al sitio del empleador en lugar de postular dentro de Indeed.
- No se leyó la cláusula de las condiciones de uso de Indeed sobre robots y scraping.

## Google for Jobs: requisitos vigentes y disponibilidad en Perú y en español

### Takeaway
Google for Jobs sigue activo y la documentación dice que está disponible "in the entire region" de América Latina (actualizada el 08/09/2026). No entrega postulaciones: envía al postulante a la página propia, y el CV llega por el formulario propio, que la plataforma ya tiene.

Los requisitos son:
- datos estructurados JobPosting con 5 propiedades obligatorias;
- Search Console para vigilar los resultados;
- Indexing API, que es gratuita, con 200 publicaciones al día por defecto, y exclusiva para páginas JobPosting o BroadcastEvent.

### Cited Findings
- **Propiedades obligatorias:** `title`, `description` ("The full description of the job in HTML format"), `datePosted`, `hiringOrganization` y `jobLocation`. `jobLocation` no hace falta si existe `applicantLocationRequirements` — [Job posting structured data](https://developers.google.com/search/docs/appearance/structured-data/job-posting) [Oficial] (actualizada el 08/09/2026).
- **Recomendadas:** `applicantLocationRequirements`, `baseSalary`, `directApply`, `employmentType`, `identifier`, `jobLocationType` y `validThrough`. Esta última es obligatoria si el aviso caduca. En beta: `educationRequirements`, `experienceRequirements` y `experienceInPlaceOfEducation` — [misma página](https://developers.google.com/search/docs/appearance/structured-data/job-posting).
- **Indexing API:** se recomienda sobre el sitemap para URLs de empleo, "because the Indexing API prompts Googlebot to crawl your page sooner". Se mantiene un sitemap para el resto del sitio. En Search Console se vigila el informe de resultados enriquecidos y el de rendimiento — [misma página](https://developers.google.com/search/docs/appearance/structured-data/job-posting).
- **Disponibilidad:** América Latina: "Available in the entire region". La página no nombra Perú ni el idioma español por separado — [misma página](https://developers.google.com/search/docs/appearance/structured-data/job-posting).
- "The Indexing API can only be used to crawl pages with either JobPosting or BroadcastEvent embedded in a VideoObject". Requisitos: habilitar la API, crear una cuenta de servicio y verificar la propiedad en Search Console — [Indexing API Quickstart](https://developers.google.com/search/apis/indexing-api/v3/quickstart) [Oficial] (actualizada el 16/10/2026).
- **Cuota y costo:** 200 solicitudes de publicación por proyecto y día (`URL_UPDATED` y `URL_DELETED`); 380 por minuto para todos los endpoints juntos. "All use of the Indexing API is available without payment" — [Quota and pricing](https://developers.google.com/search/apis/indexing-api/v3/quota-pricing) [Oficial] (actualizada el 16/10/2026).

### Inferences
- Perú está cubierto por la frase "entire region". Lo que falta comprobarlo con una búsqueda real en google.com.pe.
- Lo pendiente para la plataforma sería:
  - llamar a la Indexing API al publicar y al cerrar vacantes (`URL_UPDATED` y `URL_DELETED`);
  - poner `directApply: true` si el formulario propio cumple la definición de Google;
  - revisar los informes de Search Console.

  200 al día basta para el volumen de una empresa.

### Gaps
- La página no menciona expresamente el español ni Perú. No se hizo una búsqueda de prueba en Google Perú.
- No se transcribió la definición exacta de `directApply` (qué cuenta como postulación directa).

## Agregadores con presencia en Perú: Talent.com, Jooble, Careerjet, Jobted, Jora/SEEK, Glassdoor, Adzuna y otros

### Takeaway
Solo **Talent.com** documenta públicamente la entrega de la postulación con el CV a un endpoint propio (Talent Apply: POST JSON con el CV en base64), y tiene sitio en español en pe.talent.com. No publica si es gratuito ni cómo se autentica la petición.

**Jooble** está activo en Perú (unas 47 400 ofertas de 360 sitios). Acepta un feed XML o un enlace al sitio, pero la única opción con precio publicado es de pago ($200 o $500), y redirige sin entregar postulaciones.

No se pudo verificar en una fuente oficial la presencia en Perú de Careerjet, Jobted ni Jora. Adzuna no opera en Perú. Glassdoor muestra avisos "powered by Indeed", según una fuente secundaria.

### Cited Findings
**Talent.com**
- **Talent Apply** [Oficial] — [Talent.com Integrations](https://www.talent.com/integrations):
  - "allows job seekers to save time and apply for your jobs directly on Talent.com";
  - se activa "inserting the `<talent-apply-data>` tag to your existing feed", con atributos codificados como URL y prefijo `talent-apply-`;
  - `posturl` es obligatorio; `questions` es opcional, una URL que devuelve JSON con las preguntas. Sin ella se piden nombre, apellido, correo y teléfono.
- **Lo que envía** [Oficial] — [misma página](https://www.talent.com/integrations):
  - "send a POST call with the applicants' information (JSON format)", con los objetos `id`, `applicant`, `job` (empresa, ID, ubicación, título) y `analytics` (IP, user agent, dispositivo);
  - el CV va en `resume.file` con `fileName`, `contentType` y `data` en base64;
  - preguntas admitidas: texto, select, multiselect, condicionales, jerárquicas, fecha y otras.
- **Lo que la página no documenta:** firma, token de autenticación, costo, países ni elegibilidad — [misma página](https://www.talent.com/integrations).
- **Página para ATS** [Oficial] — [Talent.com ATS](https://lb.talent.com/en/ats):
  - ofrece Quick Apply "while delivering applications to your ATS";
  - el contacto es un formulario ("Contact us and let our team start the integration process");
  - no menciona costo ni API.
- **Presencia en Perú:** pe.talent.com responde en español, con enlaces "Para empleadores", "ATS" y "Programas para publishers", sin precios. El contenido de la página no nombra Perú — [pe.talent.com](https://pe.talent.com/) [Oficial].
- **Fuentes secundarias:**
  - Talent.com lee el feed cada 4 horas — [Lever](https://help.lever.co/hc/en-us/articles/20087440276893) [Secundaria, fragmento]; [ExactHire](https://support.exacthire.com/talent.com-job-board-integration-qa) [Secundaria, fragmento].
  - La integración "organic XML feed" es de publicación gratuita — [ExactHire](https://support.exacthire.com/talent.com-job-board-integration-qa) [Secundaria, fragmento].
  - Talent.com permite "free standard job ads and sponsored job posts" — [Betterteam](https://www.betterteam.com/talent-com) [Secundaria, fragmento].
  - En Greenhouse, la integración requiere enviar una API key al account manager de Talent.com — [Greenhouse](https://support.greenhouse.io/hc/en-us/articles/360047184372-Talent-com-integration) [Secundaria, fragmento].

**Jooble**
- **Perú** [Oficial]: "Obtenga acceso a 47400 ofertas de empleo de 360 sitios web". Tiene los enlaces "Publicar oferta" (`/employer/jobposting`) y "Compartir vacantes" (`/partner/ppc`) — [pe.jooble.org](https://pe.jooble.org/).
- **"Compartir vacantes"** [Oficial] — [pe.jooble.org/partner/ppc](https://pe.jooble.org/partner/ppc):
  - "Deja un enlace a tu sitio web con vacantes o un feed XML en la solicitud";
  - los paquetes son Premium Basic ($200) y Premium Advanced ($500), con "gestión de presupuesto y CPC";
  - "Las vacantes aparecerán en nuestro sitio web después de la moderación";
  - no se indica ninguna opción gratuita.
- **Opciones de colaboración** [Oficial, artículo del 06/01/2025] — [Jooble Help Center](https://jooblehelpcenter.freshdesk.com/en/support/solutions/articles/60000037108-why-is-partnership-with-jooble-useful-and-what-are-the-cooperation-options):
  - registrarse como empleador, integrar un ATS, un feed XML, o publicar en portales que Jooble ya indexa ("they will automatically appear on Jooble");
  - no menciona API ni webhook de postulaciones.
- **Secundaria:** la publicación gratuita directa solo existe en algunos países — [Recooty](https://recooty.com/blog/how-to-post-a-job-on-jooble/) [Secundaria, fragmento].

**Careerjet y Opcionempleo**
- `www.careerjet.com.pe` no resuelve (error DNS el 28/10/2026).
- Un blog afirma que Opcionempleo lo gestiona el mismo equipo que Careerjet — [visahunter](https://visahunter.com/?p=14730) [Secundaria, fragmento].
- opcionempleo.com.pe mostró solo una página de "Verificación requerida", así que no se pudo leer [Oficial, sin contenido].
- Careerjet recibe avisos por feed XML de proveedores ATS — [Cezanne HR](https://cezannehr.com/partner-integration/careerjet/) [Secundaria, fragmento].

**Jobted y Jora/SEEK**
- **Jobted:** no se encontró un sitio para Perú. Solo aparece jobted.es en una guía de la Comunidad de Madrid ([PDF](https://Comunidad.madrid/sites/default/files/doc/presidencia/dgae_t_peru.pdf), [Secundaria, fragmento]).
- **Jora:** pe.jora.com devolvió HTTP 403 y no se pudo verificar.

**Glassdoor**
- "Personalized job listings on Glassdoor are now powered by Indeed" — copia de una página de Glassdoor alojada por un tercero ([mirror](https://hn.jakechampion.name/reader/https://www.glassdoor.ca/about/onelogin)) [Secundaria, fragmento]. No se encontró el anuncio oficial con fecha.

**Adzuna**
- Su página "About us" lista 19 países: Australia, Austria, Bélgica, Brasil, Canadá, Francia, Alemania, India, Italia, México, Países Bajos, Nueva Zelanda, Polonia, Singapur, Sudáfrica, España, Suiza, Reino Unido y EE. UU. **Perú no está** — [Adzuna About us](https://www.adzuna.com/about-us.html) [Oficial, fragmento; adzuna.com devolvió 403 al abrirlo].

**Otro canal peruano mencionado**
- EmpleosPerú (gob.pe), la plataforma del Ministerio de Trabajo, aparece en los resultados como portal oficial gratuito [Secundaria, fragmento]. No se investigó si tiene API ni feed, porque queda fuera del alcance.

### Inferences
- **Talent.com** es el único agregador con entrega de CV documentada en una página pública, y la plataforma ya tiene su receptor.
  - Como la página no documenta firma, hay que proteger el `posturl` con un secreto largo en la URL o en un parámetro y validar el esquema. Conviene pedir por escrito a Talent.com su mecanismo de autenticación.
  - Si Talent Apply es gratuito en Perú no está confirmado oficialmente.
- **Jooble** es útil solo como fuente de tráfico: redirige a la página propia de la vacante y el CV llega por el formulario propio. Además, indexa lo publicado en portales que ya recorre (360 sitios en Perú, quizá Indeed o Computrabajo), sin hacer nada. La entrada por feed tiene precio publicado.
- **Glassdoor:** si muestra los avisos de Indeed, integrarse con Indeed cubre Glassdoor sin trabajo adicional. Esto es una inferencia sobre una fuente secundaria.

### Gaps
- No se encontró la página oficial de Talent.com que diga si el feed orgánico y Talent Apply son gratuitos, ni su cobertura en Perú. Las páginas /publishers y /enterprise solo mostraron un formulario de inicio de sesión.
- No se pudo confirmar en una fuente oficial que existan Careerjet Perú, Jobted Perú ni Jora Perú, ni cómo aceptan avisos (bloqueos 403, captcha y DNS).
- No se encontró ningún agregador, salvo Talent.com e Indeed, que entregue postulaciones por API o webhook.
- No se verificó si "Publicar oferta" en Jooble Perú es gratuito.

## Bibliotecas o SDK oficiales y herramientas prohibidas

### Takeaway
No se encontraron SDK oficiales de LinkedIn, Indeed ni Talent.com para estas integraciones. Lo oficial que existe es:
- documentación con ejemplos (la referencia de firmas de Indeed);
- el repositorio de documentación de LinkedIn en GitHub (MicrosoftDocs/linkedin-api-docs);
- una colección de Postman "LinkedIn Talent Solutions".

Los repositorios que aparecen en las búsquedas son de terceros, y en su mayoría scrapers o automatizadores que las condiciones de uso prohíben.

### Cited Findings
- Las páginas de LinkedIn Talent se generan desde `github.com/MicrosoftDocs/linkedin-api-docs`, según los metadatos `original_content_git_url` de las páginas leídas, por ejemplo [Apply Connect overview](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-overview) [Oficial]. Es un repositorio de documentación, no un SDK.
- LinkedIn remite a "LinkedIn's Postman's workspace… `LinkedIn Talent Solutions`… `Job Posting` API collection" — [Job Posting API Overview](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview) [Oficial].
- Indeed ofrece "Message signature generation reference: code samples for generating message signatures" — [Indeed Apply](https://docs.indeed.com/indeed-apply) [Oficial].
- Una búsqueda de repositorios oficiales de Indeed Apply, Apply Connect o Talent.com solo devolvió proyectos de terceros, como una "universal application gateway" (Embloy), automatizadores y scrapers. Ninguno es de esas empresas [búsqueda del 28/10/2026, sin fuente oficial].
- **PROHIBIDAS** (listadas solo para que no se usen):
  - **Scrapers de Bumeran y Computrabajo** en Apify ([bumeran-scraper](https://apify.com/blackfalcondata/bumeran-scraper), [computrabajo-scraper](https://apify.com/haketa/computrabajo-scraper.md)) [Secundaria, fragmento].
    - Bumeran prohíbe «El uso o intento de uso de cualquier máquina, software, herramienta, agente u otro mecanismo para navegar o buscar en el Sitio Web…».
    - Computrabajo dice: «El acceso o lectura mediante robots o programas automáticos no está permitido».
    - Ambas cláusulas se verificaron el 27/10/2026 en `docs/opcion-robot.md`.
  - **Scraper de Indeed** ([actor-indeed-scraper](https://awesome.ecosyste.ms/projects/github.com%2Fmetalwarrior665%2Factor-indeed-scraper)) y **automatizador de postulaciones en Indeed** ([ai-indeed-application-automation](https://awesome.ecosyste.ms/projects/github.com%2Falpharomercoma%2Fai-indeed-application-automation)) [Secundaria, fragmento]. La cláusula concreta de Indeed **no se leyó** en esta ronda.
  - **Bibliotecas no oficiales de LinkedIn:** las prohíben las [Service Terms, sec. 1.5](https://www.linkedin.com/legal/l/service-terms): "use any automated means or form of scraping or data extraction…". Verificado el 27/10/2026 en `docs/opcion-robot.md`.

### Inferences
- Para Indeed Apply y Talent Apply no hace falta un SDK. Basta un endpoint HTTP con verificación HMAC (Indeed) y la lectura del JSON, con las bibliotecas estándar de Node (`crypto`).

### Gaps
- No se buscó en GitHub directamente con su buscador. Podrían existir ejemplos oficiales no indexados.
- No se leyó la cláusula anti-scraping de las condiciones de uso de Indeed.

## Síntesis: tabla comparativa por canal

### Takeaway
Con desarrollo propio y sin pagar licencias, solo hay **dos vías oficiales de entrega automática del CV**:
- **Indeed Apply** para empleador directo: requiere Developer Agreement y una revisión de unas 6 semanas; la documentación no menciona precio.
- **Talent Apply**: ya implementado; su costo oficial no está publicado.

Las demás vías llevan al postulante al formulario propio (Google for Jobs, Jooble, publicación manual en LinkedIn o Indeed) o exigen ser socio con licencia de pago (LinkedIn Apply Connect).

### Cited Findings
Cada fila resume lo citado en las secciones anteriores. Todas las fuentes se consultaron el 28/10/2026.

| Canal | Mecanismo | ¿Recibe CV en sistema propio? | Requisitos | Costo | Disponible en Perú | Fuente |
|---|---|---|---|---|---|---|
| LinkedIn · Apply Connect | Webhook POST JSON firmado (HMAC-SHA256); CV en `mediaUrl` válido 30 días | **Sí** | Socio aprobado, contrato, certificación y licencia Recruiter Corporate o Professional Services | De pago: licencia Recruiter, precio no público | No se indica restricción por país | [Overview](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-overview); [Receive applications](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/receive-applications) |
| LinkedIn · Job Posting API | API REST (Rest.li, OAuth) para publicar avisos Basic o Promoted | No: solo publica; Apply Connect aparte | "Not accepting new partnerships" | Basic gratis; Promoted de pago | No especificado | [Job Posting API](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview) |
| LinkedIn · Basic Jobs / Limited Listings (XML) | Feed XML que LinkedIn descarga; botón de postular al sitio de origen | No: redirige al formulario propio | Contrato con LinkedIn; perfil de ATS o portal; solo para usuarios de pago del sistema emisor | Gratis para el aviso, con contrato | No especificado | [XML Feeds](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds); [Guidelines](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds-job-posting-guidelines) |
| LinkedIn · Apply with LinkedIn | Complemento en el sitio de carreras que autocompleta empleos y educación | Sí, pero cerrado | "Not accepting any new partners" | No aplica | No aplica | [AWLI](https://learn.microsoft.com/en-us/linkedin/talent/apply-with-linkedin/apply-with-linkedin) |
| LinkedIn · RSC / CRM Connect | Sincronización ATS o CRM con LinkedIn Recruiter | No: no son postulaciones | Socio y Recruiter | De pago | No especificado | [Talent overview](https://learn.microsoft.com/en-us/linkedin/talent/) |
| LinkedIn · Sign In con OIDC | OAuth 2.0/OIDC; `userinfo` | No: solo nombre, correo, foto y locale, sin experiencia | App en el Developer Portal (autoservicio) | No indicado | Global, sin restricción indicada | [OIDC](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) |
| LinkedIn · Aviso gratuito manual | Publicación a mano; postulación por LinkedIn o sitio externo | Solo vía formulario propio, si se usa el enlace externo | Cuenta de empresa; 14 días; pausa al llegar a 10–30 solicitudes | Gratis | Sí (antecedente) | [Help a522384](https://www.linkedin.com/help/linkedin/answer/a522384), vía `opcion-correos-de-aviso.md` (27/10/2026) |
| Indeed · Indeed Apply (empleador directo) | Feed XML con `<indeed-apply-data>` o Job Sync API; POST JSON a `postUrl` con `X-Indeed-Signature` (HMAC-SHA1); CV en base64 | **Sí** | Developer Agreement, Client Success, credenciales en Partner Console, revisión (~6 semanas), HTTPS con SSL válido | No mencionado en la documentación | Sin restricción indicada, salvo Japón; no confirmado para Perú | [Direct employer](https://docs.indeed.com/indeed-apply/direct-employer); [Release notes 2026](https://docs.indeed.com/release-notes/2026) |
| Indeed · Job Sync API | API GraphQL con OAuth de 2 vías; equivale al feed XML | Sí, junto con Indeed Apply | Abierta a empleadores directos desde el 31/07/2026 | No mencionado | No especificado | [Release notes 2026](https://docs.indeed.com/release-notes/2026); [FAQ](https://docs.indeed.com/job-sync-api/faq) |
| Indeed · Aviso gratuito manual / rastreo del sitio de carreras | Publicación a mano; rastreo de sitios de carreras (secundaria) | No: postula en Indeed o en el formulario propio si redirige (sin confirmar) | Cuenta de empleador | Gratis; sin límite mensual; 120 días | **Sí** | [Indeed Perú](https://pe.indeed.com/help/employers/articles/free-job-post-limit); [HR Dive](https://www.hrdive.com/news/visibility-ends-for-certain-free-single-source-xml-feeds-on-indeed/816209/) |
| Indeed · Feed XML de una sola fuente | Feed XML orgánico | No: redirige | Desde el 31/03/2026, solo patrocinado si el ATS tiene integración; exentos "homegrown systems" | Gratis si está exento | Alcance por país no indicado | [Política](https://in.indeed.com/help/employers/articles/single-source-feed-policy-effective-march-31-2026) |
| Google for Jobs | JobPosting en la página propia + Indexing API + Search Console | No: lleva al formulario propio, que sí recibe el CV | 5 propiedades obligatorias; cuenta de servicio; propiedad verificada | Gratis; 200 publicaciones al día | Sí: "entire region" de América Latina | [JobPosting](https://developers.google.com/search/docs/appearance/structured-data/job-posting); [Cuota](https://developers.google.com/search/apis/indexing-api/v3/quota-pricing) |
| Talent.com · Talent Apply | `<talent-apply-data>` en el feed XML; POST JSON a `posturl` con el CV en base64 | **Sí** | Contacto con Talent.com; feed XML | No publicado oficialmente; secundarias dicen que el feed orgánico es gratis | pe.talent.com en español; cobertura no confirmada | [Integrations](https://www.talent.com/integrations); [pe.talent.com](https://pe.talent.com/) |
| Jooble | Feed XML o enlace al sitio; o "Publicar oferta" | No: redirige al sitio | Moderación; feed según su especificación | Premium Basic $200 / Advanced $500; gratuito no confirmado | **Sí**: 47 400 ofertas de 360 sitios | [pe.jooble.org](https://pe.jooble.org/); [partner/ppc](https://pe.jooble.org/partner/ppc) |
| Careerjet / Opcionempleo | Feed XML (según secundarias) | No verificado | No verificado | No verificado | No verificado: careerjet.com.pe no resuelve; Opcionempleo pide captcha | [Cezanne](https://cezannehr.com/partner-integration/careerjet/) (secundaria) |
| Jobted | No encontrado | No | No | No | No encontrado | Búsqueda sin resultados |
| Jora / SEEK | No verificado | No verificado | No verificado | No verificado | pe.jora.com: HTTP 403 | Sin fuente |
| Glassdoor | Avisos "powered by Indeed" | Solo a través de Indeed | Los de Indeed | Los de Indeed | No verificado | [Mirror](https://hn.jakechampion.name/reader/https://www.glassdoor.ca/about/onelogin) (secundaria) |
| Adzuna | No opera en Perú | No | No | No | **No** (19 países, sin Perú) | [About us](https://www.adzuna.com/about-us.html) (fragmento) |

### Inferences
- **Orden práctico sugerido**, a validar por el coordinador:
  1. Google for Jobs (Indexing API + Search Console), gratis, sin contrato;
  2. Indeed Apply como empleador directo: es la única integración grande abierta a sistemas propios; hay que preguntar a Client Success el costo y la cobertura en Perú;
  3. Talent Apply, ya construido; pedir a Talent.com su autenticación y costo;
  4. publicación manual gratuita en LinkedIn e Indeed Perú con enlace a la página propia;
  5. Jooble solo si se acepta pagar.
- LinkedIn no ofrece a una empresa sola una vía automática gratuita. La decisión real es entre el enlace externo en los avisos o la carga masiva de los CV.

### Gaps
- Costo de la integración directa con Indeed y de Talent Apply: no publicado.
- Cobertura confirmada en Perú de Indeed Apply para empleador directo, Talent Apply, Careerjet, Jora y Glassdoor.
- Si la publicación gratuita manual de LinkedIn e Indeed en Perú permite hoy postular en el sitio externo: requiere una prueba con cuentas reales.
