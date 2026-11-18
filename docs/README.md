# Documentación

La documentación se divide en dos partes:

- **Referencia del sistema** (archivos en la raíz de `docs/`): cómo funciona la plataforma **hoy**. Se actualiza al cerrar cada etapa.
- **Etapas**: qué falta y qué sigue, resumido en la tabla siguiente y en [pendientes.md](pendientes.md). Los planes detallados por paquete (carpetas `etapa-N/`) se retiraron del proyecto el 27/10/2026.

Para una explicación sin tecnicismos, con un caso de uso completo, empiece por [como-funciona.md](como-funciona.md).

## Etapas

| Etapa | Contenido | Estado | Documento |
|---|---|---|---|
| 1 | Acceso, vacantes con criterios ponderados, candidatos y CV, evaluación por reglas, proceso de selección y auditoría | Implementada y probada contra Supabase local. **Falta el cierre** | [pendientes.md](pendientes.md) |
| 2 | Postulación en línea con un enlace por portal, carga masiva de CV, páginas públicas y feed, recepción de Talent.com, IA, extracción estructurada y OCR, revisión por requisito, comparación y feedback | En curso: terminados la carga masiva con bandeja de entrada (2.3) y las páginas públicas con su feed (2.9) | [pendientes.md](pendientes.md#etapa-2--captación-de-postulantes-y-evaluación) |
| 3 | Correo a postulantes, entrevistas con avisos y recordatorios, panel, reportes con exportación y auditoría | Implementada y probada en local. Falta un dominio verificado en Resend para enviar de verdad | [pendientes.md](pendientes.md#etapa-3--comunicaciones-entrevistas-e-informes) |
| 4 | Producción: MFA, respaldos, pruebas de seguridad | En curso: respaldo y restauración, limpieza de archivos y revisión automática de RLS hechos en local. MFA descartada por ahora. Falta la nube | [pendientes.md](pendientes.md#etapa-4--producción) |

Se recomienda **cerrar la Etapa 1 antes de empezar la 2**: el formulario público de la Etapa 2 necesita un entorno de pruebas en la nube para probarse de verdad, y ese entorno es parte del cierre.

## Referencia del sistema

| Documento | Contenido |
|---|---|
| [como-funciona.md](como-funciona.md) | Qué hace la plataforma y un caso de uso completo, para quien no conoce el proyecto |
| [arquitectura.md](arquitectura.md) | Estructura del código y decisiones técnicas |
| [seguridad.md](seguridad.md) | Controles de seguridad implementados y su ubicación |
| [metodologia-evaluacion.md](metodologia-evaluacion.md) | Criterios, fórmula, niveles y limitaciones de la evaluación |
| [roles-y-permisos.txt](roles-y-permisos.txt) | Qué puede hacer cada rol hoy |
| [configuracion-supabase.md](configuracion-supabase.md) | Proyecto, migraciones, Auth, Storage, primer administrador |
| [configuracion-ia.md](configuracion-ia.md) | Proveedor de IA, costos y minimización |
| [configuracion-correo.md](configuracion-correo.md) | Correos que envía la aplicación (Resend) y los de Supabase Auth |
| [configuracion-talent.md](configuracion-talent.md) | Recepción de postulaciones de Talent.com: cómo se activa, qué guarda, respuestas, limitaciones y mensaje para Talent.com |
| [despliegue.md](despliegue.md) | Vercel, entornos, tareas programadas y comprobaciones |
| [respaldo-y-restauracion.md](respaldo-y-restauracion.md) | Cómo respaldar y restaurar la base y los CV (probado en local) |
| [funcionamiento-app-y-robot.md](funcionamiento-app-y-robot.md) | Cómo trabajan juntos la aplicación y el robot de portales |
| [escalado-captcha.md](escalado-captcha.md) | Qué hace el robot ante un CAPTCHA |
| [guion-demo-rrhh.md](guion-demo-rrhh.md) | Guion de la demostración para RRHH |
| [informe-pruebas.md](informe-pruebas.md) | Pruebas realmente ejecutadas y resultados (se amplía con una sección por etapa) |
| [pendientes.md](pendientes.md) | Limitaciones conocidas y tareas de la Etapa 4 |

## Convenciones de los planes

- **Tamaño relativo** de cada paquete: **S**, pocos archivos y sin cambios de esquema; **M**, migración nueva con pantallas y pruebas; **L**, varios módulos, superficie pública o integración con un servicio externo. No son estimaciones de días.
- **Las migraciones ya aplicadas no se modifican**: cada cambio de esquema va en una migración nueva (también para redefinir funciones o vistas existentes).
- Cada paquete indica qué construye en la **base de datos**, el **servidor** y la **interfaz**, sus **pruebas**, sus **criterios de aceptación** y sus **decisiones pendientes**, con quién debe tomarlas: RRHH, legal, la empresa o el equipo técnico.
- Los principios de la Etapa 1 siguen vigentes en todas las etapas: seguridad en tres capas (interfaz, servidor y base de datos).
