import { DatabaseService } from 'src/database/database.service';
import { Injectable } from '@nestjs/common';

export type EtapaTablero = 'en-pesaje' | 'por-aprobar' | 'finalizado' | 'rechazado';

export interface PesajeFoto {
    id: number;
    peso_neto: string | number;
    fuera_de_rango: boolean;
    estado_calidad_codigo: string | null;
    usuario: string | null;
    created_at: Date | string;
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
        return {
            generado_en: null,
            kpis: {
                pesajes_hoy: 0,
                peso_neto_hoy: 0,
                pct_en_rango_hoy: null,
                lotes_activos: 0,
                clientes_con_actividad_hoy: 0,
            },
            clientes: [],
        };
    }
}
