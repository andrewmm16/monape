/**
 * Banderas de funcionalidad de la aplicación. Centralizan el encendido o apagado
 * de módulos que se pausan temporalmente, sin tocar permisos ni rutas.
 */

/**
 * Reclutador Caleta (sourcing de prospectos) en pausa.
 *
 * Mientras sea `true`, la opción del menú se muestra sombreada y sin acceso, y la
 * página `/caleta` queda bloqueada aunque se entre por URL directa. Los permisos
 * (`caleta:use`) y la RLS no cambian: para reactivar el módulo basta con poner
 * este valor en `false`.
 */
export const CALETA_EN_STANDBY = true;
