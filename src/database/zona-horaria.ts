import { CompiledQuery, DatabaseConnection } from 'kysely';

// Hora de Honduras (UTC-6, sin horario de verano), como offset fijo y no como
// 'America/Tegucigalpa': MySQL no tiene cargadas las tablas de zonas.
export const ZONA_HORARIA_DB = '-06:00';

// Opciones de mysql2 que toda conexion del proyecto tiene que llevar:
// - timezone: como interpreta mysql2 los DATETIME/TIMESTAMP al convertirlos a
//   Date. Sin ella usa la zona del proceso Node, que en el contenedor es UTC.
// - dateStrings DATE: una columna DATE (fecha_emision) viaja como
//   'YYYY-MM-DD' y no como un Date a medianoche, que el front pintaba un dia
//   antes.
export const opcionesZonaHoraria = {
  timezone: ZONA_HORARIA_DB,
  dateStrings: ['DATE' as const],
};

// La sesion de MySQL tambien en hora de Honduras, para que NOW(), CURDATE() y
// los DEFAULT CURRENT_TIMESTAMP no dependan de como este configurado el
// servidor.
export async function fijarZonaHorariaSesion(
  connection: DatabaseConnection,
): Promise<void> {
  await connection.executeQuery(
    CompiledQuery.raw(`SET time_zone = '${ZONA_HORARIA_DB}'`),
  );
}
