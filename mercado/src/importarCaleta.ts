import * as fs from 'fs-extra';
import * as path from 'path';
// Importa aquí tu cliente de base de datos (Prisma, Sequelize, o pg-pool según uses)
// import { db } from '../../src/config/database';

const JSON_PATH = path.join(__dirname, '..', '..', 'ofertas_mercado.json');

async function importarAvisosABaseDeDatos() {
  try {
    // 1. Leer el archivo generado por el scraper
    const data = await fs.readJson(JSON_PATH);
    // El scraper guarda un objeto { palabraClave, fecha, total, ofertas, fallidos };
    // soporta también un JSON que sea directamente un array.
    const ofertas = Array.isArray(data) ? data : (data.ofertas || []);
    console.log(`[📖] Leyendo ${ofertas.length} ofertas del archivo JSON...`);

    let importados = 0;

    for (const oferta of ofertas) {
      // 2. Filtrar: Solo nos interesan los que tengan números de teléfono detectados
      if (oferta.telefonos && oferta.telefonos.length > 0) {

        for (const telefono of oferta.telefonos) {
          console.log(`[💥] Teléfono detectado para vacante: ${oferta.titulo} -> ${telefono}`);

          // 3. Insertar en tu tabla temporal de "Candidatos Caleta" o "Prospectos"
          // Reemplaza este bloque por la sintaxis exacta de tu base de datos:
          /*
          await db.candidatosCaleta.create({
            data: {
              nombre: `Contacto Reclutador - ${oferta.empresa || 'Confidencial'}`,
              puesto: oferta.titulo,
              telefono: telefono,
              origen: 'Computrabajo Scraper',
              estado: 'PENDIENTE_CONTACTO',
              fechaCaptura: new Date()
            }
          });
          */
          importados++;
        }
      }
    }

    console.log(`[🏁] Proceso de importación terminado. Se cargaron ${importados} nuevos prospectos al flujo de WhatsApp.`);

  } catch (error: any) {
    console.error(`[❌] Error al importar los datos: ${error.message}`);
  }
}

importarAvisosABaseDeDatos();
