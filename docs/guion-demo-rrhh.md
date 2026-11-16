# Guion de demo para RRHH

**Objetivo:** mostrar en ~10-12 minutos cómo la plataforma ayuda a RRHH a ordenar, evaluar y mover candidatos — con **evaluación explicable**, **killer questions** y **auditoría**.

**Antes de empezar (checklist):**
- [ ] `npm run dev` corriendo → `http://localhost:3000`
- [ ] Supabase local levantado
- [ ] Datos de demo cargados (`scripts/seed-demo.ts` ya ejecutado)
- [ ] Sesión lista: `admin@reclutamiento.test` o `rrhh@reclutamiento.test` (contraseña del `.env.local`)
- [ ] Tener a mano los PDFs de `cv-prueba/` (los "04_falla_killer" quedaron sin cargar para subir en vivo)

---

## Recorrido

### 1. Login y Panel (1 min)
Entra y muestra el **Panel**: vacantes publicadas, candidatos por etapa, evaluaciones pendientes, próximas entrevistas. Mensaje: *"Todo el proceso en un solo lugar."*

### 2. La vacante y sus criterios (2 min)
Abre **Vacantes → Desarrollador Full Stack → pestaña "Requisitos y criterios"**.
- Muestra los **requisitos ponderados** (React peso 9, Node/Laravel 8, SQL 7…) y la **prioridad** (obligatorio/deseable).
- Baja a **"Preguntas eliminatorias"**: "¿Resides en Lima?", "¿Años de experiencia?", "¿Disponibilidad híbrida?".
- Punchline: *"RRHH define qué importa y cuánto pesa; la evaluación es objetiva y reproducible."*

### 3. La evaluación explicable — EL DIFERENCIADOR (3 min)
Entra a los **candidatos** de esa vacante. Vas a ver 3 niveles distintos:
- **Diego Quispe (alta, 100)** · **Rosa Mendoza (parcial, 66.67)** · **Jorge Torres (pendiente, killer incumplida)**

Abre la **evaluación de Diego**:
- Muestra cómo por cada requisito dice **acreditado / sin evidencia / pendiente**, y **cita el extracto literal del CV** que lo respalda.
- Punchline: *"No es una caja negra como otros sistemas. Cada punto se justifica con evidencia del CV, y nunca marca 'no cumple' sin pruebas."*

### 4. Killer questions en acción (1 min)
Abre la postulación de **Jorge** (o Pablo en RRHH): muestra la marca **"No cumple la condición indicada"**.
- Punchline: *"La plataforma lo señala, pero no lo elimina: sigue visible. La decisión siempre es de RRHH."*

### 5. Comparar candidatos (1 min)
Usa **"Comparar"** (2-4 candidatos) para verlos lado a lado y el orden sugerido de "mejor opción".

### 6. Pipeline + correo de entrevista (2 min)
Mueve a **Diego** a **"entrevista programada"** y **programa una entrevista** (fecha, modalidad, lugar).
- Muestra que al candidato **le llega el correo de invitación** (ver nota de correo abajo).
- Al cambiar un estado, muestra el checkbox **"Avisar al candidato por correo"**.
- Punchline: *"RRHH coordina todo desde aquí; el candidato recibe los avisos automáticamente."*

### 7. Reportes / KPIs (1 min)
Entra a **Reportes**: embudo por etapa, de qué fuente vienen los candidatos, tiempos. Opción de **exportar a CSV**.
- Punchline: *"Métricas para decidir y justificar, exportables."*

### 8. Pool de talento (1 min)
**Candidatos → Búsqueda avanzada**: usa el campo de **texto libre** y busca "React" (o "Excel" / "planillas") para **reutilizar candidatos de procesos anteriores**. *Nota: con los datos de demo, busca por texto libre (sí devuelve resultados); el filtro por "habilidad" puede salir vacío porque los CV traen la skill en el texto, no como etiqueta.*

### 9. (Opcional, impacto) Subida de CV en vivo (1-2 min)
**Vacantes → Desarrollador Full Stack → "Carga masiva de CV"** → elige un portal (ej. "Página de empleos") → **sube** `cv-prueba/01_Desarrollador_Full_Stack/04_falla_killer_Camila_Huaman_Chavez.pdf`. La app **extrae nombre/correo/teléfono sola**, detecta duplicados, y al registrar la postulación **la evalúa al instante**.
*Nota: la carga masiva no pide killer questions (esas son del formulario público); se lucen con los candidatos ya cargados. Aquí el gancho es la extracción + evaluación automática.*

### 10. Cierre
Menciona: **auditoría** (todo cambio queda registrado).

---

## Puntos a verificar ANTES de la demo (pasada rápida)
1. ~~**Pool de talento**: consulta verificada contra la BD (pool, reportes y CSV funcionan sin error).~~ ✅ Verificado. Recuerda buscar por **texto libre**, no por "habilidad".
2. **Correo real**: la invitación de entrevista solo llega a **tu propio correo** (`onboarding@resend.dev` es sandbox). Para la demo: programa la entrevista a un candidato con tu correo, o solo muestra que "se envió" sin abrir el buzón. Para enviar a cualquiera, hay que verificar un dominio en Resend.
3. **Subida de CV**: prueba una vez el flujo de subida con un PDF de `cv-prueba/` para que no te sorprenda en vivo.

## Mensajes de venta clave (si preguntan "¿por qué esto y no Pandapé?")
- **Explicable y auditable**: cada evaluación muestra evidencia; Pandapé es caja negra.
- **Respeta la privacidad y nunca decide sola**: coherente con lo legal.
- **Sourcing propio** (Reclutador Caleta): busca candidatos, no solo espera.
- **A medida y económico**: sin licencias mensuales por usuario.
