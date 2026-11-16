# Reclutador Caleta — Sourcing automático

Pipeline diario que busca CVs públicos en Google, los procesa en `caleta_prospects`, **filtra por afinidad** y contacta a los top N por WhatsApp.

## Comandos

| Comando | Qué hace | Dónde se corre |
|---|---|---|
| `npm run caleta:buscar` | Google/DDG X-Ray con dorks por vacante, guarda `salida/urls-cvs.json` | **En tu PowerShell**, no en Claude Code (sandbox) |
| `npm run caleta:procesar` | Descarga PDFs, extrae nombre+tel+correo+LinkedIn, inserta en `caleta_prospects` | Donde sea (usa Supabase local + pdftotext) |
| `npm run caleta:puntuar` | Puntúa los nuevos con el motor de afinidad y **descarta** los que no pasan el filtro (indispensables + umbral) | Donde sea (usa Supabase local) |
| `npm run caleta:whatsapp` | Envía WhatsApp a top N (5 por defecto) por vacante con pausas humanas | Donde sea |
| `npm run caleta:diario` | Encadena los 4 anteriores | **En tu PowerShell**, porque incluye `caleta:buscar` |

Flags útiles:

```bash
npm run caleta:buscar -- --vacante=civil             # solo una vacante
npm run caleta:procesar -- --dry                     # solo analiza, no inserta
npm run caleta:puntuar -- --umbral=50                # sube la vara de afinidad a 50%
npm run caleta:puntuar -- --dry                      # muestra las decisiones, no escribe
npm run caleta:whatsapp -- --limite=3                # top 3 por vacante
npm run caleta:whatsapp -- --vacante="Ingeniero Sanitario"
npm run caleta:diario -- --sin-buscar                # reaprovecha urls-cvs.json existente
npm run caleta:diario -- --sin-contactar             # solo cosecha y puntúa, no envía
```

## Filtro de afinidad (`caleta:puntuar`)

Tras insertar, cada prospecto nuevo se puntúa contra los requisitos de su vacante con el mismo motor determinista del panel. **Pasa** (queda `encontrado`, apto para contactar) si:

- **todos** los requisitos marcados como indispensables (`is_essential` en la vacante) tienen evidencia positiva en el CV, **y**
- el **score de afinidad ≥ umbral** (por defecto 40 %, configurable con `CALETA_UMBRAL_AFINIDAD` o `--umbral`).

Los que no pasan quedan `descartado`: no se contactan y en `/caleta` caen en su propia sección al final, pero se conservan con su score por si luego cambias los requisitos. `caleta:whatsapp` ya contacta solo a los `encontrado`, así que el filtro surte efecto automáticamente.

> Sobre los indispensables: el motor nunca marca `acreditado` un requisito esencial (eso exige verificación documental de RRHH), sino `pendiente_verificacion` cuando el CV aporta evidencia. Para este pre-filtro de sourcing, `pendiente_verificacion` cuenta como "lo cumple"; un indispensable solo bloquea si está `sin_evidencia` o `no_cumplido`. Si una vacante no tiene requisitos indispensables, el gate opera solo por el umbral.

## Primera vez (vincular WhatsApp)

El script usa su propia carpeta de sesión (`CALETA_WHATSAPP_DIR`, default `.caleta-whatsapp`). Recomendado: **cuenta distinta** a la del bot principal (chip dedicado) para proteger tu número personal.

1. Lanza `npm run caleta:whatsapp -- --dry` una vez para generar la carpeta.
2. Luego `npm run caleta:whatsapp` — imprime un QR en consola.
3. En WhatsApp móvil: Configuración → Dispositivos vinculados → Vincular → escanea el QR.
4. A partir de aquí la sesión queda guardada y no vuelve a pedir QR.

## Configuración (`.env.local`)

```ini
# Obligatorios (ya los tienes)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=***

# Caleta
CALETA_WHATSAPP_DIR=.caleta-whatsapp        # ignora en .gitignore
CALETA_RECLUTADOR_NOMBRE=Pedro Córdova
CALETA_EMPRESA=Nombre de tu empresa
CALETA_LIMITE_DIARIO=5                      # tope por vacante por corrida
CALETA_PAUSA_MIN_SEG=60
CALETA_PAUSA_MAX_SEG=90
CALETA_UMBRAL_AFINIDAD=40                   # % mínimo de afinidad para no descartar (filtro)
```

## Programar como tarea diaria (Windows Task Scheduler)

1. Abre **Programador de tareas** → Crear tarea básica.
2. Nombre: "Caleta Diario".
3. Desencadenador: Diariamente, hora recomendada: **09:00 AM** (hora de buena respuesta en Lima).
4. Acción: Iniciar un programa:
   - Programa: `C:\Program Files\nodejs\node.exe`
   - Argumentos: `scripts/caleta/caleta-diario.mjs`
   - Iniciar en: `C:\Users\Admin\Desktop\p1`
5. Pestaña "Condiciones": desmarca "Iniciar la tarea solo si el equipo tiene alimentación de CA".
6. Finalizar.

Como el script usa Playwright para la búsqueda en Google, puede disparar una verificación anti-bots ocasionalmente. Mitigación: pausas de 8-15 s entre queries + fallback a DuckDuckGo automático.

## Salidas

- `salida/urls-cvs.json` — URLs de CVs encontradas en la última corrida.
- `salida/pdfs/*.pdf` — PDFs descargados (hash del URL como nombre).
- `salida/procesados.json` — log de los CVs procesados en la última corrida.
- `salida/logs/YYYY-MM-DD.log` — reservado para el orquestador.

## Flujo completo

```
09:00 cada día (Task Scheduler)
  ↓
caleta-diario.mjs
  ↓
├─ buscar-cvs-google.mjs  (Playwright → Google → urls-cvs.json)
├─ procesar-cvs.mjs       (descarga + pdftotext + parseo + insert, status='encontrado')
├─ puntuar-prospectos.ts  (motor de afinidad + gate → aptos 'encontrado', resto 'descartado')
└─ enviar-whatsapp-caleta.mjs  (Baileys → top 5 APTOS por vacante → UPDATE status)
  ↓
Candidato responde con CV (vía bot/src/notify/incoming.ts)
  ↓
[próximo paso: motor de afinidad evalúa el CV y decide derivar]
```

## Notas y riesgos

- **Google**: respeta `site:` y `filetype:` operadores. Con pausas humanas aguanta bien. Si capta, fallback automático a DDG.
- **WhatsApp Baileys**: no oficial, violación leve de ToS. Con límite de 5-6/vacante/día (= 15-18 msjs/día totales) y pausas de 60-90 s, el riesgo de ban es bajo pero existe. Usa número dedicado.
- **Ley 29733 Perú**: los teléfonos en los CVs son datos **declarados por el propio candidato** al subir su CV públicamente a internet. Zona gris pero mucho más tranquila que bases filtradas. El primer mensaje siempre ofrece opt-out ("si no es el momento, dímelo y no te vuelvo a escribir").
- **Volumen esperado**: ~5-15 CVs útiles por corrida diaria para 3 vacantes (depende de qué tan saturado esté Google). Lo normal al principio es 5-10, luego se estabiliza porque los nuevos son los que han subido CV recientemente.
