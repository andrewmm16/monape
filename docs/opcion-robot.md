# Opción B · Robot que entra a la cuenta de empresa del portal

**Versión 1 · 27/10/2026 · Estado: evaluada; no recomendada y no implementada.** Portales cubiertos: LinkedIn, Bumeran y Trabajos Diarios. Se añade Computrabajo porque su revisión estaba pendiente. La revisión de condiciones de uso es una lectura técnica de los textos publicados por cada portal: **no es una opinión legal** y debe validarla el área legal.

## Resumen

Un programa con un navegador automático entra con el usuario y la contraseña de la empresa al panel de cada portal, descarga los CV de los postulantes y los registra en la plataforma cada cierto tiempo.

**Conclusión:**
- LinkedIn, Bumeran Perú y Computrabajo Perú **lo prohíben expresamente** en sus condiciones, y se reservan el derecho de suspender la cuenta. En Bumeran y Computrabajo, además, la contraseña es intransferible.
- Trabajos Diarios **no lo menciona**, pero sus condiciones son breves, sin fecha y sin entidad legal identificada.

**No se recomienda construirlo** para ninguno de los tres primeros. Para Trabajos Diarios, solo después de preguntárselo por escrito al portal.

## Cómo funcionaría

```
Cada hora, en un servidor aparte:
  1. Un navegador automático abre el portal
  2. Inicia sesión con el usuario y la contraseña de la empresa
  3. Abre la lista de postulantes de cada vacante publicada
  4. Descarga los CV nuevos
  5. Los registra en la plataforma por el mismo camino que la carga masiva
  6. Cierra la sesión
```

**Lo que exigiría**
- Un servidor aparte con un navegador, porque no funciona en el alojamiento actual (Vercel).
- Guardar cifradas las contraseñas de las cuentas de empresa de los portales.
- Un guion distinto por portal, que se rompe cuando el portal cambia su sitio.
- No funciona si el portal pide captcha o verificación en dos pasos. **No se diseñaría para evadir esas protecciones.**

## Revisión de condiciones de uso (consultadas el 27/10/2026)

| Portal | Veredicto | Cláusulas | Fuente |
|---|---|---|---|
| **LinkedIn** | **Prohibido** | *"Except as expressly authorized by LinkedIn in writing, use any automated means or form of scraping or data extraction to access, modify, download, query"*. El Acuerdo de Usuario también prohíbe compartir la cuenta y las credenciales: *"use or attempt to use another's account (such as sharing log-in credentials or copying cookies)"*. | [Service Terms, sec. 1.5](https://www.linkedin.com/legal/l/service-terms) (06/08/2026), verificado. [Acuerdo de Usuario, secs. 2.2 y 8.2](https://www.linkedin.com/legal/user-agreement), consultado el 27/10/2026 |
| **Bumeran Perú** | **Prohibido** | Uso prohibido: «El uso o intento de uso de cualquier máquina, software, herramienta, agente u otro mecanismo para navegar o buscar en el Sitio Web que sean distintos a las herramientas de búsqueda provistos por BUMERAN». También: «Revelar o compartir su contraseña con terceras personas». Puede «suspender en forma indefinida o dar de baja a cualquier Solicitante» que incurra en usos prohibidos. | Condiciones Generales de Contratación de Perú (10/4/2025) y Términos y Condiciones de Uso de Perú (8/7/2024), en bumeran.com.pe. Entidad: Bumeran.com Perú S.A.C. |
| **Computrabajo Perú** | **Prohibido** | «El acceso o lectura mediante robots o programas automáticos no está permitido». «No utilizar mecanismos, software o scripts en relación con la utilización del Sitio Web». «El uso de la contraseña es personal e intransferible, no estando permitida la cesión, ni siquiera temporal, a terceros». | [pe.computrabajo.com/avisolegal](https://pe.computrabajo.com/avisolegal/) (14/10/2026) |
| **Trabajos Diarios** | **No lo prohíbe expresamente** | Sus términos no mencionan robots ni herramientas automáticas. Exigen «abstenerse de utilizar el sitio web para fines ilícitos» y «Cada usuario será responsable de mantener la confidencialidad de su contraseña». | [pe.trabajosdiarios.com/terminos-condiciones](https://pe.trabajosdiarios.com/terminos-condiciones). Sin fecha ni entidad legal |

**Sobre las bibliotecas no oficiales** que automatizan LinkedIn: las mismas cláusulas las prohíben. Usarlas pone en riesgo la cuenta de empresa, que es justo donde se publican las vacantes.

## Ventajas y desventajas

| A favor | En contra |
|---|---|
| Funcionaría aunque el portal no envíe el CV por correo | Viola las condiciones de LinkedIn, Bumeran y Computrabajo |
| El postulante no hace ningún paso extra | Riesgo de que suspendan la cuenta de empresa y se pierdan las publicaciones |
|  | Obliga a guardar las contraseñas de los portales |
|  | Se rompe con cualquier cambio del sitio, un captcha o la verificación en dos pasos |
|  | Necesita un servidor aparte y mantenimiento continuo |

## Alternativas legítimas por portal

| Portal | Alternativa |
|---|---|
| **LinkedIn** | La opción de correos ([opcion-correos-de-aviso.md](opcion-correos-de-aviso.md)), si el correo trae el CV. Si no, la carga masiva, que sus condiciones parecen admitir porque permiten pasar los datos a un ATS de la empresa. La vía oficial (Apply Connect) exige ser socio de LinkedIn y una licencia de pago. |
| **Bumeran** | La opción de correos, si el correo trae el CV. Si no, la carga masiva. No se encontró una API pública ni un programa de socios. |
| **Trabajos Diarios** | La opción de correos o la carga masiva. Si aun así se quisiera el robot, primero hay que pedir al portal, por escrito, que lo autorice. |
| **Computrabajo** | Pandapé, su herramienta de pago autorizada, o una autorización escrita del portal. Ver la advertencia en [opcion-correos-de-aviso.md](opcion-correos-de-aviso.md#advertencia-sobre-computrabajo). |

## Si algún portal lo autorizara por escrito

Solo entonces se construiría, y con estas condiciones:
- en un servidor aparte, con la contraseña cifrada y fuera del código;
- con frecuencia baja, por ejemplo una vez por hora, y sin ocultarse como si fuera una persona;
- si el portal pide captcha o verificación, el robot se detiene y avisa;
- con la misma revisión, el mismo aviso de duplicados y la misma evaluación que la carga masiva.

**Nivel de verificación:**
- Las cláusulas se leyeron directamente de los sitios de cada portal el 27/10/2026.
- Nada de esta opción está implementado ni probado.
