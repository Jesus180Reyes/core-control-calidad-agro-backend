import { DatabaseService } from 'src/database/database.service';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

export type EtapaTablero = 'en-pesaje' | 'por-aprobar' | 'finalizado' | 'rechazado';

export interface PesajeFoto {
    id: number;
    peso_neto: string | number | null;
    fuera_de_rango: boolean;
    estado_calidad_codigo: string | null;
    usuario: string | null;
    created_at: Date | string | null;
}

export interface LoteFoto {
    id: number;
    nombre_lote: string;
    producto: string | null;
    unidad_medida: string | null;
    etapa: EtapaTablero;
    peso_minimo: string | number;
    peso_ideal: string | number;
    peso_maximo: string | number;
    bultos: number;
    bultos_fuera_rango: number;
    peso_neto_total: number;
    ultimos_pesajes: PesajeFoto[];
}

export interface ClienteFoto {
    id: number;
    nombre: string;
    producto: string | null;
    codigo_exportacion: string | null;
    lotes: LoteFoto[];
}

export interface KpisFoto {
    pesajes_hoy: number;
    peso_neto_hoy: number;
    pct_en_rango_hoy: number | null;
    lotes_activos: number;
    clientes_con_actividad_hoy: number;
}

export interface PlantaFoto {
    generado_en: Date | string | null;
    kpis: KpisFoto;
    clientes: ClienteFoto[];
}

@Injectable()
export class PlantasRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async getPlantaEnVivo(): Promise<PlantaFoto> {
        const lotes = await this.getLotesFoto();

        // Un IN () vacio es un error de SQL: sin lotes no se ejecutan las consultas 2 y 3.
        const loteIds = lotes.map((l) => l.id);
        const [totales, ultimos] = loteIds.length
            ? await Promise.all([
                this.getTotalesPorLote(loteIds),
                this.getUltimosPesajes(loteIds),
            ])
            : [[], []];

        const totalesPorLote = new Map(totales.map((t) => [Number(t.lote_id), t]));
        const pesajesPorLote = new Map<number, PesajeFoto[]>();
        for (const p of ultimos) {
            const loteId = Number(p.lote_id);
            const lista = pesajesPorLote.get(loteId) ?? [];
            lista.push({
                id: Number(p.id),
                peso_neto: p.peso_neto,
                fuera_de_rango: !!p.fuera_de_rango,
                estado_calidad_codigo: p.estado_calidad_codigo,
                usuario: p.usuario,
                created_at: p.created_at,
            });
            pesajesPorLote.set(loteId, lista);
        }

        const clientes: ClienteFoto[] = [];
        const clientesPorId = new Map<number, ClienteFoto>();
        for (const l of lotes) {
            let cliente = clientesPorId.get(l.cliente_id);
            if (!cliente) {
                cliente = {
                    id: l.cliente_id,
                    nombre: l.cliente_nombre,
                    producto: l.cliente_producto,
                    codigo_exportacion: l.cliente_codigo_exportacion,
                    lotes: [],
                };
                clientesPorId.set(l.cliente_id, cliente);
                clientes.push(cliente);
            }
            const total = totalesPorLote.get(l.id);
            cliente.lotes.push({
                id: l.id,
                nombre_lote: l.nombre_lote,
                producto: l.producto,
                unidad_medida: l.unidad_medida,
                etapa: l.etapa,
                peso_minimo: l.peso_minimo,
                peso_ideal: l.peso_ideal,
                peso_maximo: l.peso_maximo,
                bultos: Number(total?.bultos ?? 0),
                bultos_fuera_rango: Number(total?.bultos_fuera_rango ?? 0),
                peso_neto_total: redondear2(Number(total?.peso_neto_total ?? 0)),
                ultimos_pesajes: pesajesPorLote.get(l.id) ?? [],
            });
        }

        const kpis = await this.getKpisHoy();
        const pesajesHoy = Number(kpis.pesajes_hoy ?? 0);

        return {
            generado_en: kpis.generado_en,
            kpis: {
                pesajes_hoy: pesajesHoy,
                peso_neto_hoy: redondear2(Number(kpis.peso_neto_hoy ?? 0)),
                pct_en_rango_hoy: pesajesHoy
                    ? redondear2((100 * Number(kpis.en_rango_hoy ?? 0)) / pesajesHoy)
                    : null,
                lotes_activos: lotes.filter(
                    (l) => l.etapa === 'en-pesaje' || l.etapa === 'por-aprobar',
                ).length,
                clientes_con_actividad_hoy: Number(kpis.clientes_con_actividad_hoy ?? 0),
            },
            clientes,
        };
    }

    // La casilla sale de etapas.codigo, nunca de los ids: cambian entre ambientes.
    // Un lote con etapa_id en NULL o con un codigo desconocido no entra en la foto.
    private async getLotesFoto() {
        const lotes = await this.db
            .selectFrom('lotes')
            .innerJoin('clientes', 'clientes.id', 'lotes.cliente_id')
            .leftJoin('productos as producto_cliente', 'producto_cliente.id', 'clientes.producto_id')
            .leftJoin('productos', 'productos.id', 'lotes.producto_id')
            .leftJoin('unidades_medida', 'unidades_medida.id', 'lotes.unidad_medida_id')
            .leftJoin('etapas', 'etapas.id', 'lotes.etapa_id')
            .select([
                'clientes.id as cliente_id',
                'clientes.nombre as cliente_nombre',
                'producto_cliente.nombre as cliente_producto',
                'clientes.codigo_exportacion as cliente_codigo_exportacion',
                'lotes.id',
                'lotes.nombre_lote',
                'productos.nombre as producto',
                'unidades_medida.nombre as unidad_medida',
                'lotes.peso_minimo',
                'lotes.peso_ideal',
                'lotes.peso_maximo',
                sql<EtapaTablero>`CASE etapas.codigo
                    WHEN 'EN_PROCESO' THEN 'en-pesaje'
                    WHEN 'CLIENTE_FINAL' THEN 'por-aprobar'
                    WHEN 'FINALIZADO' THEN 'finalizado'
                    WHEN 'RECHAZADO' THEN 'rechazado'
                END`.as('etapa'),
            ])
            .where('clientes.isActive', '=', 1)
            .where((eb) =>
                eb.or([
                    eb('etapas.codigo', 'in', ['EN_PROCESO', 'CLIENTE_FINAL']),
                    eb.and([
                        eb('etapas.codigo', '=', 'FINALIZADO'),
                        eb('lotes.finalizado_en', '>=', sql<Date>`NOW() - INTERVAL 7 DAY`),
                    ]),
                    eb.and([
                        eb('etapas.codigo', '=', 'RECHAZADO'),
                        eb('lotes.rechazado_en', '>=', sql<Date>`NOW() - INTERVAL 5 MINUTE`),
                    ]),
                ]),
            )
            .orderBy('clientes.id', 'asc')
            .orderBy('lotes.id', 'asc')
            .execute();
        return lotes;
    }

    // bultos cuenta todo el lote: el front detecta anulaciones porque baja.
    // Un lote sin pesajes activos no sale del GROUP BY y se completa con ceros.
    private async getTotalesPorLote(loteIds: number[]) {
        return await this.db
            .selectFrom('pesajes')
            .select([
                'pesajes.lote_id',
                sql<number>`COUNT(*)`.as('bultos'),
                sql<number | string | null>`SUM(pesajes.fuera_de_rango = 1)`.as('bultos_fuera_rango'),
                sql<number | string | null>`SUM(pesajes.peso_neto)`.as('peso_neto_total'),
            ])
            .where('pesajes.lote_id', 'in', loteIds)
            .where('pesajes.isActive', '=', 1)
            .groupBy('pesajes.lote_id')
            .execute();
    }

    // Ordenado por id y no por created_at: el front decide que un pesaje es nuevo
    // porque su id supera al mayor que ya veia en el lote.
    private async getUltimosPesajes(loteIds: number[]) {
        return await this.db
            .selectFrom((eb) =>
                eb
                    .selectFrom('pesajes')
                    .leftJoin('estados_calidad', 'estados_calidad.id', 'pesajes.estado_calidad_id')
                    .leftJoin('usuarios', 'usuarios.id', 'pesajes.usuario_id')
                    .select([
                        'pesajes.id',
                        'pesajes.lote_id',
                        'pesajes.peso_neto',
                        'pesajes.fuera_de_rango',
                        'estados_calidad.codigo as estado_calidad_codigo',
                        'usuarios.complete_name as usuario',
                        'pesajes.created_at',
                        sql<number>`ROW_NUMBER() OVER (PARTITION BY pesajes.lote_id ORDER BY pesajes.id DESC)`.as('rn'),
                    ])
                    .where('pesajes.lote_id', 'in', loteIds)
                    .where('pesajes.isActive', '=', 1)
                    .as('p'),
            )
            .select([
                'p.id',
                'p.lote_id',
                'p.peso_neto',
                'p.fuera_de_rango',
                'p.estado_calidad_codigo',
                'p.usuario',
                'p.created_at',
            ])
            .where('p.rn', '<=', 10)
            .orderBy('p.lote_id', 'asc')
            .orderBy('p.id', 'desc')
            .execute();
    }

    // Sobre todos los pesajes activos de hoy de la planta, no solo los de la foto.
    // "Hoy" es la regla de SPEC 28. NOW() viaja en la misma consulta como generado_en.
    private async getKpisHoy() {
        return await this.db
            .selectFrom('pesajes')
            .leftJoin('lotes', 'lotes.id', 'pesajes.lote_id')
            .select([
                sql<Date | string>`NOW()`.as('generado_en'),
                sql<number>`COUNT(*)`.as('pesajes_hoy'),
                sql<number | string | null>`SUM(pesajes.peso_neto)`.as('peso_neto_hoy'),
                sql<number | string | null>`SUM(pesajes.fuera_de_rango = 0)`.as('en_rango_hoy'),
                sql<number>`COUNT(DISTINCT lotes.cliente_id)`.as('clientes_con_actividad_hoy'),
            ])
            .where('pesajes.isActive', '=', 1)
            .where('pesajes.created_at', '>=', sql<Date>`CURDATE()`)
            .where('pesajes.created_at', '<', sql<Date>`DATE_ADD(CURDATE(), INTERVAL 1 DAY)`)
            .executeTakeFirstOrThrow();
    }
}

function redondear2(valor: number) {
    return Math.round(valor * 100) / 100;
}
