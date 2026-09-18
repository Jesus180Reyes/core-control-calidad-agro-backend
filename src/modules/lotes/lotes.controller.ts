import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LotesService } from './lotes.service';
import { CreateLoteDto } from './dto/create-lote.dto';
import { RechazarLoteDto } from './dto/rechazar-lote.dto';
import { FinalizarLoteDto } from './dto/finalizar-lote.dto';

@ApiTags('lotes')
@ApiBearerAuth()
@Controller('lotes')
export class LotesController {
    constructor(private readonly lotesService: LotesService) { }

    @Get('cliente/:clienteId')
    @ApiOperation({
        summary: 'Lotes abiertos de un cliente',
        description:
            'Lotes en curso del cliente, con producto, unidad de medida y etapa resueltos a nombre. ' +
            'Filtra estado = abierto, asi que no lista los cerrados, rechazados ni finalizados. ' +
            'Nunca expone resumen_ia. Ordena por created_at DESC. ' +
            'Es una de las pocas rutas que SI valida el vinculo cliente_operador: responde 403 si ' +
            'el usuario del token no esta vinculado al cliente.',
    })
    @ApiParam({ name: 'clienteId', description: 'Id del cliente', example: 1 })
    async findAllByCliente(
        @Param('clienteId', ParseIntPipe) clienteId: number,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const lotes = await this.lotesService.findAllByCliente(clienteId, userId);
        return {
            ok: !!lotes,
            msg: 'Lotes obtenidos correctamente',
            lotes,
        };
    }
    @Get('cliente/:clienteId/all')
    @ApiOperation({
        summary: 'Lotes abiertos de un cliente, sin validar el vinculo',
        description:
            'Misma consulta y mismos campos que GET /lotes/cliente/{clienteId}. La unica ' +
            'diferencia es que NO valida el vinculo cliente_operador: cualquier usuario ' +
            'autenticado obtiene los lotes de cualquier cliente. ' +
            'Pese al nombre no son "todos" los lotes: filtra estado = abierto igual que la otra, ' +
            'asi que tampoco lista los rechazados ni los finalizados.',
    })
    @ApiParam({ name: 'clienteId', description: 'Id del cliente', example: 1 })
    async findAllLotesByCliente(
        @Param('clienteId', ParseIntPipe) clienteId: number,
    ) {
        const lotes = await this.lotesService.findAllLotesByCliente(clienteId);
        return {
            ok: !!lotes,
            msg: 'Lotes obtenidos correctamente',
            lotes,
        };
    }
    @Get('cliente/:clienteId/all/approver')
    @ApiOperation({
        summary: 'Bandeja del aprobador: lotes en CLIENTE_FINAL',
        description:
            'Los lotes que un supervisor ya envio a la etapa CLIENTE_FINAL y esperan al aprobador. ' +
            'Mismos campos que las otras dos rutas cliente/..., pero filtra estado = cerrado, asi ' +
            'que es el unico listado de lotes cerrados de la API. ' +
            'CUIDADO: la etapa se filtra con un id 2 hardcodeado, no resolviendo el codigo ' +
            'CLIENTE_FINAL. Si en un ambiente ese codigo no es el id 2, esta ruta devuelve datos ' +
            'equivocados sin fallar. Un lote finalizado deja de aparecer aqui. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'clienteId', description: 'Id del cliente', example: 1 })
    async findAllLotesByClienteForApprover(
        @Param('clienteId', ParseIntPipe) clienteId: number,
    ) {
        const lotes = await this.lotesService.findAllLotesByClienteForApprover(clienteId);
        return {
            ok: !!lotes,
            msg: 'Lotes obtenidos correctamente',
            lotes,
        };
    }

    @Get('cliente/:clienteId/all/finalizados')
    @ApiOperation({
        summary: 'Lotes finalizados de un cliente',
        description:
            'Los lotes que el aprobador ya firmo como terminados, es decir los que estan en la ' +
            'etapa FINALIZADO. Es la unica lectura que los muestra: las otras tres rutas ' +
            'cliente/... filtran estado = abierto o la etapa CLIENTE_FINAL, asi que un lote ' +
            'finalizado desaparece de todas ellas y aparece aqui. ' +
            'Devuelve los mismos 10 campos que sus tres hermanas mas cuatro de auditoria: ' +
            'aprobado_por, aprobado_en, finalizado_por y finalizado_en. Es el unico endpoint del ' +
            'proyecto que expone quien firmo un lote y cuando; los dos usuarios viajan con su ' +
            'nombre completo, nunca con su id. La terna de rechazo no viaja: en un lote ' +
            'finalizado es siempre null. ' +
            'La etapa se resuelve por el codigo FINALIZADO, no por un id hardcodeado, a diferencia ' +
            'de la bandeja del aprobador. Si esa fila falta en etapas, responde 400. ' +
            'Ordena por finalizado_en DESC, no por created_at como las otras tres. ' +
            'No acepta ningun query param. Un cliente sin lotes finalizados, o un clienteId que no ' +
            'existe, responden 200 con una lista vacia. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'clienteId', description: 'Id del cliente', example: 1 })
    async findAllLotesFinalizadosByCliente(
        @Param('clienteId', ParseIntPipe) clienteId: number,
    ) {
        const lotes =
            await this.lotesService.findAllLotesFinalizadosByCliente(clienteId);
        return {
            ok: !!lotes,
            msg: 'Lotes obtenidos correctamente',
            lotes,
        };
    }

    @Post()
    @HttpCode(201)
    @ApiOperation({
        summary: 'Crear un lote',
        description:
            'Crea el lote abierto y en la primera etapa del flujo. El nombre_lote debe estar libre ' +
            'dentro del cliente, validado solo en codigo y sin restriccion en MySQL; un lote ' +
            'rechazado libera su nombre, uno aprobado no. ' +
            'Valida el vinculo cliente_operador: responde 403 si el usuario no esta vinculado al ' +
            'cliente. Es el unico POST que no devuelve nada de lo que creo: responde { ok, msg } ' +
            'sin el id del lote.',
    })
    async create(@Body() dto: CreateLoteDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const lote = await this.lotesService.create(dto, userId);
        return {
            ok: !!lote,
            msg: 'Lote creado correctamente',
        };
    }

    @Patch(':id/rechazar')
    @ApiOperation({
        summary: 'Rechazar un lote abierto',
        description:
            'Anulacion logica del lote: lo cierra y lo manda a la etapa RECHAZADO, con el motivo y ' +
            'la auditoria de quien y cuando. Exige que el lote este ABIERTO. Irreversible, y ningun ' +
            'endpoint lista lotes rechazados. ' +
            'NO hay cascada: sus pesajes siguen activos y visibles, pero POST /pesajes y ' +
            'PATCH /pesajes/{id}/rechazar empiezan a fallar sobre ese lote, asi que esos pesajes ' +
            'quedan imposibles de anular. Libera el nombre_lote para reutilizarse. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'id', description: 'Id del lote a rechazar', example: 1 })
    async rechazar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RechazarLoteDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const rechazado = await this.lotesService.rechazar(id, dto, userId);
        return {
            ok: rechazado,
            msg: 'Lote rechazado correctamente',
        };
    }

    @Patch(':id/rechazar/byApprover')
    @ApiOperation({
        summary: 'Rechazar un lote ya cerrado, como aprobador',
        description:
            'El aprobador anula un lote que YA esta cerrado en la etapa CLIENTE_FINAL. La ' +
            'precondicion es la contraria a la del resto de escrituras del proyecto, que exigen el ' +
            'lote abierto. Solo mueve la etapa a RECHAZADO y escribe el motivo y la auditoria: no ' +
            'toca estado ni cerrado_en, que ya los escribio la aprobacion, asi que el lote queda ' +
            'con motivo_rechazo y aprobado_por a la vez. Un lote finalizado ya no admite esta ' +
            'llamada. NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'id', description: 'Id del lote a rechazar', example: 1 })
    async rechazarByApprover(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RechazarLoteDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const rechazado = await this.lotesService.rechazarByApprover(
            id,
            dto,
            userId,
        );
        return {
            ok: rechazado,
            msg: 'Lote rechazado correctamente',
        };
    }

    @Patch(':id/aprobar')
    @ApiOperation({
        summary: 'Aprobar un lote y enviarlo a CLIENTE_FINAL',
        description:
            'El supervisor firma el lote y lo mueve a la etapa CLIENTE_FINAL, cerrandolo. Exige el ' +
            'lote abierto, en la etapa EN_PROCESO y con al menos un pesaje activo. Sin cuerpo de ' +
            'peticion: la aprobacion no lleva texto libre. Irreversible. ' +
            'OJO con lo que cuesta cerrar el lote: desde aqui POST /pesajes falla, de modo que NO ' +
            'se puede pesar en la etapa CLIENTE_FINAL. No libera el nombre_lote. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'id', description: 'Id del lote a aprobar', example: 1 })
    async aprobar(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const aprobado = await this.lotesService.aprobar(id, userId);
        return {
            ok: aprobado,
            msg: 'Lote aprobado correctamente',
        };
    }

    @Patch(':id/finalizar/byApprover')
    @ApiOperation({
        summary: 'Finalizar un lote, como aprobador',
        description:
            'Ultimo paso del flujo: mueve el lote a la etapa FINALIZADO. Es lo unico en el proyecto ' +
            'que escribe esa etapa. ' +
            'EXIGE un cuerpo con firma_aprobador: la firma manuscrita del aprobador como data URL ' +
            'de PNG en base64, es decir una cadena que empieza por "data:image/png;base64,". Es ' +
            'obligatoria, de modo que una llamada sin cuerpo responde 400; solo se acepta PNG, y el ' +
            'maximo son 500000 caracteres. La firma se guarda y NO la devuelve ninguna lectura de ' +
            'la API, ni siquiera el listado de lotes finalizados. ' +
            'Exige que el lote este cerrado en CLIENTE_FINAL, que no haya sido finalizado ya y que ' +
            'TODOS sus pesajes activos esten revisados, es decir con aprobado distinto de null. Pide ' +
            'revisados, no aprobados: un lote cuyos pesajes el aprobador rechazo todos finaliza bien. ' +
            'CONGELA el lote: las otras tres rutas del aprobador exigen CLIENTE_FINAL y a partir de ' +
            'aqui fallan. Y el lote desaparece de TODAS las lecturas de lotes; solo sus pesajes ' +
            'siguen siendo visibles. No hay cascada y no libera el nombre_lote. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'id', description: 'Id del lote a finalizar', example: 1 })
    async finalizarByApprover(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: FinalizarLoteDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const finalizado = await this.lotesService.finalizar(id, dto, userId);
        return {
            ok: finalizado,
            msg: 'Lote finalizado correctamente',
        };
    }
}
