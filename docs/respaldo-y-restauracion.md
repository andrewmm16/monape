# Respaldo y restauración

Procedimiento probado en local el 18/11/2026: se respaldó la base de pruebas (64 tablas, 1101 filas y 55 CV), se borró por completo, se restauró y se comprobaron las filas de cada tabla, la huella de cada archivo y el ingreso de un usuario del respaldo. Contra un proyecto en la nube **aún no se ensayó**: hágalo en *staging* antes de depender de él.

## Qué se respalda

| Parte | Cómo | Dónde queda |
|---|---|---|
| **Datos** de la aplicación y de Supabase Auth (usuarios, contraseñas cifradas, factores de verificación) | `supabase db dump --data-only` (pg_dump en un contenedor) | `datos.sql` |
| **Archivos de CV** del bucket `resumes` | API de Storage con la clave de servicio | `archivos/…` |
| **Manifiesto** con filas por tabla, huella SHA-256 de cada archivo y última migración | — | `manifiesto.json` |

El **esquema** no se respalda: lo definen las migraciones del repositorio. Por eso un respaldo se restaura sobre un esquema que esté en la **misma migración** (`lastMigration` del manifiesto). El script lo comprueba.

> El respaldo tiene **datos personales**. La carpeta `respaldos/` está en `.gitignore`. Guárdelo cifrado (por ejemplo, un volumen cifrado o un archivo 7-Zip con AES-256) y fuera del equipo de trabajo. Borre las copias que ya no necesite.

## Respaldar

Requiere Docker y el archivo de entorno del proyecto (URL de Supabase y `SUPABASE_SECRET_KEY`).

```bash
# Local (stack de `npx supabase start`)
npx tsx --env-file=.env.local scripts/respaldo/respaldar.ts

# Nube: la URL de conexión está en Supabase → Project Settings → Database
npx tsx --env-file=.env.produccion scripts/respaldo/respaldar.ts --db-url "postgresql://postgres.<ref>:<clave>@<host>:5432/postgres"
```

Opciones:
- `--destino <carpeta>`: por defecto, `respaldos/<fecha>`.
- `--workdir <carpeta con supabase/>`: otro stack local.

Además, en la nube, Supabase hace copias diarias en los planes de pago. Este respaldo sirve para tener una copia propia, para migrar entre proyectos y para ensayar la restauración.

## Restaurar

La restauración **reemplaza** todos los datos del destino: vacía las tablas de `public`, `private` y `auth` y carga el respaldo **en una sola transacción**. Si algo falla, el destino queda como estaba. Después vuelve a subir los CV y verifica sus huellas.

1. Deje el destino con el esquema en la misma migración que el respaldo:
   - local: `npx supabase db reset --no-seed`;
   - nube (proyecto nuevo): `npx supabase link` y `npx supabase db push`.
2. Ejecute la restauración, confirmando el destino de forma explícita:

   ```bash
   # Local
   npx tsx --env-file=.env.local scripts/respaldo/restaurar.ts --desde respaldos/<fecha> --confirmar local

   # Nube (--confirmar con el host de la URL)
   npx tsx --env-file=.env.produccion scripts/respaldo/restaurar.ts --desde respaldos/<fecha> \
     --db-url "postgresql://…@<host>:5432/postgres" --confirmar <host>
   ```
3. Compruebe que puede ingresar con un usuario del respaldo y abrir un CV.

El script se detiene sin cambiar nada si:
- falta `--confirmar` o no coincide con el destino;
- la migración del repositorio es distinta de la del respaldo (`--forzar` lo omite bajo su responsabilidad);
- un archivo del respaldo no coincide con su huella.

Al terminar, si las filas de alguna tabla no coinciden con el manifiesto, lo informa con error.

## Frecuencia recomendada

- Antes de cada despliegue con migraciones nuevas.
- Semanal en producción, conservando las últimas 4 copias, y otra mensual durante el plazo que defina la empresa.
- Un ensayo de restauración en *staging* cada trimestre: un respaldo que nunca se restauró no está probado.
