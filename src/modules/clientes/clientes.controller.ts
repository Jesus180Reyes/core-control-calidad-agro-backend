import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { RechazarClienteDto } from './dto/rechazar-cliente.dto';
import { EditarClienteDto } from './dto/editar-cliente.dto';
import { FiltrosClientesDto } from './dto/filtros-clientes.dto';
import { PaginacionClientesDto } from './dto/paginacion-clientes.dto';

@ApiTags('clientes')
@ApiBearerAuth()
@Controller('clientes')
export class ClientesController {
    constructor(private readonly clientesService: ClientesService) { }

    @Get('all')
    @ApiOperation({
        summary: 'Todos los clientes activos',
        description:
            'Devuelve TODOS los clientes activos, sin filtrar por cliente_operador: no es la ' +
            'cartera del que llama. Cualquier usuario autenticado, OPERADOR incluido, recibe la ' +
            'lista completa. Los cuatro filtros son opcionales y se combinan con AND: nombre es ' +
            'parcial (LIKE), mientras que rtn y codigo_exportacion son exactos, asi que un ' +
            'fragmento devuelve una lista vacia. Se puede buscar por rtn pero el rtn no viene en ' +
            'la respuesta. A diferencia de los filtros de pesajes, aqui un valor invalido SI ' +
            'devuelve 400. Nunca lista clientes rechazados. Ordena por created_at ASC. ' +
            'Paginacion opcional con pagina y limite: sin ellos la respuesta es la lista completa; ' +
            'con al menos uno valido se agrega la clave paginacion { pagina, limite, total, ' +
            'total_paginas } y el que falte toma su default (pagina 1, limite 20). limite se topa ' +
            'en 100. Al contrario que los filtros, un pagina o limite invalido se ignora y nunca ' +
            'devuelve 400. Una pagina mas alla de la ultima devuelve una lista vacia, no un error.',
    })
    async findAllGlobal(@Query() filtros: FiltrosClientesDto) {
        const { clientes, paginacion } =
            await this.clientesService.findAllGlobal(filtros);
        return {
            ok: true,
            msg: 'Clientes obtenidos correctamente',
            clientes,
            ...(paginacion && { paginacion }),
        };
    }

    @Get()
    @ApiOperation({
        summary: 'Cartera de clientes del usuario',
        description:
            'Solo los clientes vinculados al usuario del token por cliente_operador. ' +
            'Los UNICOS query params que acepta son pagina y limite; cualquier otro no se ' +
            'rechaza, se ignora, asi que ?nombre=agro devuelve la cartera completa sin filtrar. ' +
            'Los filtros existen solo en GET /clientes/all. Mismos seis campos que esa ruta, pero ' +
            'ordenados por nombre ASC. Paginacion opcional: sin pagina ni limite la respuesta es ' +
            'la cartera completa; con al menos uno valido se agrega la clave paginacion { pagina, ' +
            'limite, total, total_paginas } y el que falte toma su default (pagina 1, limite 20). ' +
            'limite se topa en 100, un valor invalido se ignora y nunca devuelve 400, y una pagina ' +
            'mas alla de la ultima devuelve una lista vacia.',
    })
    async findAll(@Query() params: PaginacionClientesDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const { clientes, paginacion } = await this.clientesService.findAll(
            userId,
            params,
        );
        return {
            ok: true,
            msg: 'Clientes obtenidos correctamente',
            clientes,
            ...(paginacion && { paginacion }),
        };
    }

    @Get(':id/operadores')
    @ApiOperation({
        summary: 'Operadores vinculados a un cliente',
        description:
            'Devuelve los operadores vinculados al cliente por cliente_operador, cada uno como ' +
            '{ id, nombre }, ordenados por nombre ASC. Solo lista usuarios con isActive = 1 y rol ' +
            'OPERADOR, el mismo filtro que GET /catalogos/operadores: un vinculo a un usuario ' +
            'inactivo o con otro rol existe en la tabla pero no se muestra. Un cliente sin ' +
            'operadores devuelve una lista vacia. Un cliente inexistente o rechazado responde 400. ' +
            'NO valida el vinculo cliente_operador del que llama: cualquier usuario autenticado ' +
            'lee los vinculos de cualquier cliente.',
    })
    @ApiParam({ name: 'id', description: 'Id del cliente', example: 1 })
    async findOperadores(@Param('id', ParseIntPipe) id: number) {
        const operadores = await this.clientesService.findOperadores(id);
        return {
            ok: true,
            msg: 'Operadores del cliente obtenidos correctamente',
            operadores,
        };
    }

    @Post()
    @HttpCode(201)
    @ApiOperation({
        summary: 'Crear un cliente',
        description:
            'Crea el cliente y, con usuario_ids, lo vincula a esos operadores en cliente_operador. ' +
            'Esa es la unica forma de crear el vinculo: no hay endpoints para gestionarlo despues. ' +
            'El rtn y el codigo_exportacion deben estar libres, pero la unicidad se valida solo en ' +
            'codigo, sin restriccion en MySQL, y los validadores ignoran a los clientes rechazados, ' +
            'asi que un rtn rechazado se puede reutilizar. Devuelve el id creado, no el cliente. ' +
            'No valida rol: un OPERADOR puede crear clientes.',
    })
    async create(@Body() dto: CreateClienteDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const cliente = await this.clientesService.create(dto, userId);
        return {
            ok: true,
            msg: 'Cliente creado correctamente',
            cliente,
        };
    }

    @Patch(':id/rechazar')
    @ApiOperation({
        summary: 'Rechazar un cliente',
        description:
            'Desactivacion logica del cliente: isActive = 0 mas el motivo y la auditoria de quien ' +
            'y cuando. Irreversible, y ningun endpoint lista clientes rechazados, asi que el ' +
            'cliente queda inalcanzable por API. NO hay cascada: sus lotes siguen abiertos, sus ' +
            'pesajes siguen activos y sus vinculos cliente_operador quedan intactos. Libera el rtn ' +
            'y el codigo_exportacion para reutilizarse. ' +
            'NO valida el vinculo cliente_operador: cualquier usuario autenticado puede rechazar ' +
            'el cliente de otro.',
    })
    @ApiParam({ name: 'id', description: 'Id del cliente a rechazar', example: 1 })
    async rechazar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RechazarClienteDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const rechazado = await this.clientesService.rechazar(id, dto, userId);
        return {
            ok: rechazado,
            msg: 'Cliente rechazado correctamente',
        };
    }

    @Patch(':id')
    @ApiOperation({
        summary: 'Editar un cliente',
        description:
            'Edicion parcial de un cliente activo. Campos editables, todos opcionales: nombre, ' +
            'producto_id, correo_contacto, telefono, direccion_planta, ubicacionLongitud, ' +
            'ubicacionLatitude y constancia_exonerado; hay que enviar al menos uno o responde 400. ' +
            'Solo se escriben los campos enviados, mas updated_at y actualizado_por (el usuario del ' +
            'token). rtn y codigo_exportacion NO se pueden editar: si llegan en el cuerpo se ignoran. ' +
            'Ningun campo se puede vaciar: null o una cadena vacia responden 400. Cambiar el nombre ' +
            'cambia tambien el nombre que muestran las facturas ya registradas en ' +
            'GET /documentos-fiscales/:id, porque el documento lee el cliente por JOIN. Un cliente ' +
            'rechazado o inexistente responde 400, igual que un producto_id inexistente o inactivo. ' +
            'Responde { ok, msg } sin el cliente. ' +
            'NO valida el vinculo cliente_operador: cualquier usuario autenticado puede editar ' +
            'cualquier cliente.',
    })
    @ApiParam({ name: 'id', description: 'Id del cliente a editar', example: 1 })
    async editar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: EditarClienteDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const editado = await this.clientesService.editar(id, dto, userId);
        return {
            ok: editado,
            msg: 'Cliente actualizado correctamente',
        };
    }
}
