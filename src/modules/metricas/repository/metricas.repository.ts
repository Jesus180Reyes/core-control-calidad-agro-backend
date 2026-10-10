import { DatabaseService } from 'src/database/database.service';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { FiltrosMetricasCalidadDto } from '../dto/filtros-metricas-calidad.dto';

type Periodo = { desde: string; hasta: string };

// Una fila de agregados tal como la devuelve MySQL: COUNT y SUM llegan como
// numero o como texto segun el driver, AVG y STDDEV_POP como texto o null.
type FilaAgregados = {
    total_pesajes: string | number | null;
    fuera_de_rango: string | number | null;
    desviacion_promedio_pct: string | number | null;
    desviacion_estandar_pct: string | number | null;
    aprobados_por_aprobador: string | number | null;
    rechazados_por_aprobador: string | number | null;
    sin_revisar: string | number | null;
    anulados: string | number | null;
};

export type IndicadoresCalidad = {
    total_pesajes: number;
    fuera_de_rango: number;
    porcentaje_fuera_de_rango: number | null;
    desviacion_promedio_pct: number | null;
    desviacion_estandar_pct: number | null;
    aprobados_por_aprobador: number;
    rechazados_por_aprobador: number;
    sin_revisar: number;
    porcentaje_rechazo_aprobador: number | null;
    anulados: number;
    porcentaje_anulacion: number | null;
};

@Injectable()
export class MetricasRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    // Tres consultas sobre la misma base, mas la del periodo. Corren con
    // Promise.all sobre la conexion unica del request, que las serializa.
    async getMetricasCalidad(filtros: FiltrosMetricasCalidadDto) {
        const periodo = await this.resolverPeriodo(filtros);
        const base = () => this.baseCalidad(periodo, filtros);

        const [filaResumen, filasEstado, filasCliente] = await Promise.all([
            base()
                .where('pesajes.isActive', 'in', [0, 1])
                .select(this.agregados())
                .executeTakeFirstOrThrow(),

            // La base va como tabla derivada en un LEFT JOIN: las condiciones
            // del periodo quedan del lado del join y los estados sin pesajes
            // se conservan con total 0.
            this.db
                .selectFrom('estados_calidad')
                .leftJoin(
                    base()
                        .where('pesajes.isActive', '=', 1)
                        .select('pesajes.estado_calidad_id')
                        .as('p'),
                    (join) => join.onRef('p.estado_calidad_id', '=', 'estados_calidad.id'),
                )
                .select((eb) => [
                    'estados_calidad.id as estado_calidad_id',
                    'estados_calidad.codigo',
                    'estados_calidad.nombre',
                    eb.fn.count('p.estado_calidad_id').as('total'),
                ])
                .groupBy([
                    'estados_calidad.id',
                    'estados_calidad.codigo',
                    'estados_calidad.nombre',
                ])
                .orderBy('estados_calidad.id', 'asc')
                .execute(),

            base()
                .leftJoin('clientes', 'clientes.id', 'lotes.cliente_id')
                .where('pesajes.isActive', 'in', [0, 1])
                .select(['lotes.cliente_id', 'clientes.nombre as cliente', ...this.agregados()])
                .groupBy(['lotes.cliente_id', 'clientes.nombre'])
                .orderBy('total_pesajes', 'desc')
                .orderBy('lotes.cliente_id', 'asc')
                .execute(),
        ]);

        const resumen = this.calcularIndicadores(filaResumen);

        return {
            periodo,
            filtros: {
                cliente_id: filtros.cliente_id ?? null,
                usuario_id: filtros.usuario_id ?? null,
            },
            resumen,
            por_estado_calidad: filasEstado.map((e) => {
                const total = Number(e.total);
                return {
                    estado_calidad_id: e.estado_calidad_id,
                    codigo: e.codigo,
                    nombre: e.nombre,
                    total,
                    porcentaje: resumen.total_pesajes === 0
                        ? null
                        : Math.round((total / resumen.total_pesajes) * 100 * 100) / 100,
                };
            }),
            por_cliente: filasCliente.map((c) => ({
                cliente_id: Number(c.cliente_id),
                cliente: c.cliente ?? null,
                ...this.calcularIndicadores(c),
            })),
        };
    }

    // Agregados condicionales: activos y anulados salen del mismo recorrido.
    // La desviacion es relativa al peso_ideal de cada lote y tiene signo; los
    // CASE sin ELSE dejan NULL, que AVG y STDDEV_POP ignoran.
    private agregados() {
        const activo = sql`pesajes.isActive = 1`;
        const conDesviacion = sql`pesajes.isActive = 1 AND pesajes.peso_neto IS NOT NULL AND lotes.peso_ideal > 0`;
        const desviacion = sql`(pesajes.peso_neto - lotes.peso_ideal) / lotes.peso_ideal * 100`;
        type Agregado = string | number | null;

        return [
            sql<Agregado>`SUM(CASE WHEN ${activo} THEN 1 ELSE 0 END)`.as('total_pesajes'),
            sql<Agregado>`SUM(CASE WHEN ${activo} AND pesajes.fuera_de_rango = 1 THEN 1 ELSE 0 END)`.as('fuera_de_rango'),
            sql<Agregado>`AVG(CASE WHEN ${conDesviacion} THEN ${desviacion} END)`.as('desviacion_promedio_pct'),
            sql<Agregado>`STDDEV_POP(CASE WHEN ${conDesviacion} THEN ${desviacion} END)`.as('desviacion_estandar_pct'),
            sql<Agregado>`SUM(CASE WHEN ${activo} AND pesajes.aprobado = 1 THEN 1 ELSE 0 END)`.as('aprobados_por_aprobador'),
            sql<Agregado>`SUM(CASE WHEN ${activo} AND pesajes.aprobado = 0 THEN 1 ELSE 0 END)`.as('rechazados_por_aprobador'),
            sql<Agregado>`SUM(CASE WHEN ${activo} AND pesajes.aprobado IS NULL THEN 1 ELSE 0 END)`.as('sin_revisar'),
            sql<Agregado>`SUM(CASE WHEN pesajes.isActive = 0 THEN 1 ELSE 0 END)`.as('anulados'),
        ];
    }

    // El periodo se resuelve con el reloj de MySQL, el mismo con el que NOW()
    // escribe pesajes.created_at. Sin extremos son los ultimos 30 dias con hoy
    // incluido; con uno solo, el otro se completa para formar 30 dias.
    private async resolverPeriodo(filtros: FiltrosMetricasCalidadDto): Promise<Periodo> {
        const hasta = filtros.hasta !== undefined
            ? sql`${filtros.hasta}`
            : sql`CURDATE()`;

        const desde = filtros.desde !== undefined
            ? sql`${filtros.desde}`
            : sql`DATE_SUB(${hasta}, INTERVAL 29 DAY)`;

        const formato = '%Y-%m-%d';

        const { rows } = await sql<Periodo>`
            SELECT DATE_FORMAT(${desde}, ${formato}) AS desde,
                   DATE_FORMAT(${hasta}, ${formato}) AS hasta
        `.execute(this.db);

        return rows[0];
    }

    // Base del periodo: pesajes con lote, en el rango y con los filtros
    // recibidos. No filtra isActive (cada consulta decide entre activos y
    // anulados) ni el estado del lote o del cliente, por decision del SPEC 35.
    // El INNER JOIN descarta los pesajes con lote_id NULL.
    private baseCalidad(periodo: Periodo, filtros: FiltrosMetricasCalidadDto) {
        let query = this.db
            .selectFrom('pesajes')
            .innerJoin('lotes', 'lotes.id', 'pesajes.lote_id')
            .where('pesajes.created_at', '>=', sql<Date>`${periodo.desde}`)
            .where(
                'pesajes.created_at',
                '<',
                sql<Date>`DATE_ADD(${periodo.hasta}, INTERVAL 1 DAY)`,
            );

        if (filtros.cliente_id !== undefined) {
            query = query.where('lotes.cliente_id', '=', filtros.cliente_id);
        }

        if (filtros.usuario_id !== undefined) {
            query = query.where('pesajes.usuario_id', '=', filtros.usuario_id);
        }

        return query;
    }

    // Pura: convierte una fila de agregados en los once indicadores. Los
    // porcentajes se calculan aqui, con 2 decimales, y valen null cuando el
    // denominador es 0 para distinguir "sin datos" de "0%".
    private calcularIndicadores(fila: FilaAgregados): IndicadoresCalidad {
        const entero = (v: string | number | null) => Number(v ?? 0);
        const redondear = (v: number) => Math.round(v * 100) / 100;
        const decimal = (v: string | number | null) =>
            v === null ? null : redondear(Number(v));
        const porcentaje = (parte: number, total: number) =>
            total === 0 ? null : redondear((parte / total) * 100);

        const total_pesajes = entero(fila.total_pesajes);
        const fuera_de_rango = entero(fila.fuera_de_rango);
        const aprobados_por_aprobador = entero(fila.aprobados_por_aprobador);
        const rechazados_por_aprobador = entero(fila.rechazados_por_aprobador);
        const sin_revisar = entero(fila.sin_revisar);
        const anulados = entero(fila.anulados);

        return {
            total_pesajes,
            fuera_de_rango,
            porcentaje_fuera_de_rango: porcentaje(fuera_de_rango, total_pesajes),
            desviacion_promedio_pct: decimal(fila.desviacion_promedio_pct),
            desviacion_estandar_pct: decimal(fila.desviacion_estandar_pct),
            aprobados_por_aprobador,
            rechazados_por_aprobador,
            sin_revisar,
            porcentaje_rechazo_aprobador: porcentaje(
                rechazados_por_aprobador,
                aprobados_por_aprobador + rechazados_por_aprobador,
            ),
            anulados,
            porcentaje_anulacion: porcentaje(anulados, total_pesajes + anulados),
        };
    }
}
