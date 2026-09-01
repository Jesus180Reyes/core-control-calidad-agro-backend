import { Generated } from 'kysely';

export interface UsuariosTable {
  id: Generated<number>;
  username: string | null;
  complete_name: string;
  rol_id: number;
  password: string;
  isActive: number | null;
  created_at: Generated<Date | null>;
  updated_at: Generated<Date | null>;
  created_by: number | null;
  cedula: string | null;
}
export interface LotesTable {
  id: Generated<number>;
  cliente_id: number;
  nombre_lote: string;
  producto_id: number;
  unidad_medida_id: number;
  etapa_id: number | null;
  created_by: number;
  variedad_o_talla: string | null;
  resumen_ia: string | null;
  cerrado_en: Date | string | null;
  peso_minimo: string | number;
  peso_ideal: string | number;
  peso_maximo: string | number;
  estado: Generated<string | null>;
  created_at: Generated<Date | string | null>;
  updated_at: Generated<Date | string | null>;
}
export interface EstadosCalidadTable {
  id: Generated<number>;
  codigo: string;
  nombre: string;
  created_at: Generated<Date | string | null>;
}
export interface PesajesTable {
  id: Generated<string | number>;
  lote_id: number | null;
  usuario_id: number | null;
  estado_calidad_id: number;
  peso_bruto: number | null;
  peso_neto: number | null;
  tara: Generated<string | number | null>;
  isActive: Generated<number | null>;
  dispositivo_identificador: string | null;
  secuencia_dispositivo: number | null;
  created_at: Generated<Date | string | null>;
  fuera_de_rango: boolean | null;
  motivo_rechazo: string | null;
  rechazado_por: number | null;
  rechazado_en: Date | string | null;
}
export interface ProductosTable {
  id: Generated<number>;
  nombre: string;
  codigo_upc: string | null;
  descripcion: string | null;
  isActive: Generated<number | null>;
  created_at: Generated<Date | string | null>;
}
export interface RolesTable {
  id: Generated<number>;
  nombre: string;
  descripcion: string | null;
  created_by: number | null;
  created_at: Generated<Date | string | null>;
  updated_at: Generated<Date | string | null>;
}

export interface UnidadMedidaTable {
  id: Generated<number>;
  codigo: string | null;
  nombre: string | null;
  created_at: Generated<Date | string | null>;
}
export interface ClientesTable {
  id: Generated<number>;
  nombre: string;
  rtn: string;
  producto_id: number | null;
  codigo_exportacion: string | null;
  correo_contacto: string | null;
  telefono: string | null;
  direccion_planta: string | null;
  ubicacionLongitud: string | null;
  ubicacionLatitude: string | null;
  isActive: Generated<number | null>;
  created_by: number | null;
  created_at: Generated<Date | string | null>;
  updated_at: Generated<Date | string | null>;
  motivo_rechazo: string | null;
  rechazado_por: number | null;
  rechazado_en: Date | string | null;
}

export interface ClienteOperadorTable {
  id: Generated<number>;
  cliente_id: number;
  usuario_id: number;
  created_at: Generated<Date | string | null>;
}

export interface EtapasTable {
  id: Generated<number>;
  codigo: string;
  nombre: string;
  created_at: Generated<Date>;
}

export interface PermisosTable {
  id: Generated<number>;
  rol_id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  isActive: Generated<number>;
  created_at: Generated<Date | string | null>;
}

export interface Database {
  usuarios: UsuariosTable;
  lotes: LotesTable;
  estados_calidad: EstadosCalidadTable;
  pesajes: PesajesTable;
  productos: ProductosTable;
  roles: RolesTable;
  unidades_medida: UnidadMedidaTable;
  clientes: ClientesTable;
  cliente_operador: ClienteOperadorTable;
  etapas: EtapasTable;
  permisos: PermisosTable;
}
