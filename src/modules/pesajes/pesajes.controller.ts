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
import { PesajesService } from './pesajes.service';
import { CreatePesajeDto } from './dto/create-pesaje.dto';
import { RechazarPesajeDto } from './dto/rechazar-pesaje.dto';
import { FiltrosPesajesLoteDto } from './dto/filtros-pesajes-lote.dto';
import { FiltrosHistorialDto } from './dto/filtros-historial.dto';

@ApiTags('pesajes')
@ApiBearerAuth()
@Controller('pesajes')
export class PesajesController {
    constructor(private readonly pesajesService: PesajesService) { }

    @Get('historial')
    @ApiOperation({
        summary: 'Historial de pesajes del usuario autenticado',
        description:
            'Los pesajes que registro el usuario del token. El filtro ES el token: no hay forma de ' +
            'pedir el historial de otro usuario, y por eso NO existe un query param usuario_id. ' +
            'Los siete filtros son opcionales y se combinan con AND; ninguno puede quitar el filtro ' +
            'por usuario ni mostrar pesajes anulados. Un valor invalido se ignora, nunca devuelve ' +
            '400. fuera_de_rango acepta true o false: 1 y 0 se ignoran. nombre busca sobre el ' +
            'nombre del lote, no sobre el del cliente. ' +
            'A diferencia del resto de lecturas, no filtra por estado del lote ni por cliente ' +
            'activo: es el unico endpoint que muestra el nombre de un lote cerrado y el de un ' +
            'cliente rechazado. Sin paginacion. Un token de un usuario que ya no existe recibe una ' +
            'lista vacia, no un error.',
    })
    async findHistorial(
        @Query() filtros: FiltrosHistorialDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const pesajes = await this.pesajesService.findHistorial(userId, filtros);
        return {
            ok: !!pesajes,
            msg: 'Historial de pesajes obtenido correctamente',
            pesajes,
        };
    }

    @Get('byLote/:loteId')
    @ApiOperation({
        summary: 'Pesajes de un lote',
        description:
            'Pesajes de un lote, de todos los operadores, con estado de calidad y usuario resueltos ' +
            'a nombre. Solo los activos: los anulados no aparecen. Ordena por created_at DESC. ' +
            'Los cinco filtros son opcionales y se combinan con AND. Un valor invalido se ignora, ' +
            'nunca devuelve 400. fuera_de_rango acepta true o false: 1 y 0 se ignoran, aunque la ' +
            'respuesta devuelva el campo como booleano. El lote y el filtro de activos se aplican ' +
            'siempre, digan lo que digan los parametros. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'loteId', description: 'Id del lote', example: 1 })
    async findAllByLote(
        @Param('loteId', ParseIntPipe) loteId: number,
        @Query() filtros: FiltrosPesajesLoteDto,
    ) {
        const pesajes = await this.pesajesService.findAllByLote(loteId, filtros);
        return {
            ok: !!pesajes,
            msg: 'Pesajes obtenidos correctamente',
            pesajes,
        };
    }

    @Post()
    @HttpCode(201)
    @ApiOperation({
        summary: 'Registrar un pesaje',
        description:
            'Un pesaje por peticion. El backend calcula el peso neto, si quedo fuera de rango y el ' +
            'estado de calidad: el cuerpo NO acepta ninguno de los tres. ' +
            'Exige que el lote este abierto, de modo que un lote aprobado, rechazado o finalizado ya ' +
            'no admite pesajes. Valida el vinculo cliente_operador, resolviendo el cliente desde el ' +
            'lote: responde 403 si el usuario no esta vinculado. ' +
            'Devuelve solo el id, el peso neto y el indicador de fuera de rango.',
    })
    async create(@Body() dto: CreatePesajeDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const pesaje = await this.pesajesService.create(dto, userId);
        return {
            ok: !!pesaje,
            msg: 'Pesaje guardado correctamente',
            pesaje,
        };
    }

    @Patch(':id/rechazar')
    @ApiOperation({
        summary: 'Anular un pesaje',
        description:
            'Anulacion logica del pesaje: isActive = 0 mas el motivo y la auditoria de quien y ' +
            'cuando. NO es el estado de calidad RECHAZADO ni el rechazo del aprobador: los pesos y ' +
            'el estado de calidad quedan intactos. El pesaje desaparece de los dos listados. ' +
            'Exige que el lote siga abierto, asi que los pesajes de un lote ya cerrado no se pueden ' +
            'anular. Irreversible. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'id', description: 'Id del pesaje a anular', example: 1 })
    async rechazar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RechazarPesajeDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const rechazado = await this.pesajesService.rechazar(id, dto, userId);
        return {
            ok: rechazado,
            msg: 'Pesaje rechazado correctamente',
        };
    }
    @Patch(':id/rechazar/byApprover')
    @ApiOperation({
        summary: 'Rechazar un pesaje, como aprobador',
        description:
            'El veredicto de "no" del aprobador sobre un pesaje: marca aprobado = 0 y escribe el ' +
            'motivo y la auditoria. La diferencia con PATCH /pesajes/{id}/rechazar es el punto del ' +
            'endpoint: el pesaje SIGUE ACTIVO y visible en los dos listados, marcado como no ' +
            'aprobado, en vez de desaparecer. ' +
            'Exige que el lote este cerrado y en la etapa CLIENTE_FINAL, y que el pesaje no haya ' +
            'sido revisado ya. Irreversible: una revision no se deshace. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'id', description: 'Id del pesaje a rechazar', example: 1 })
    async rechazarByAp(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RechazarPesajeDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const rechazado = await this.pesajesService.rechazarByApprover(id, dto, userId);
        return {
            ok: rechazado,
            msg: 'Pesaje rechazado correctamente',
        };
    }
    @Patch(':id/aprobar/byApprover')
    @ApiOperation({
        summary: 'Aprobar un pesaje, como aprobador',
        description:
            'El veredicto de "si" del aprobador. Es lo UNICO en el proyecto que marca un pesaje ' +
            'como aprobado. Sin cuerpo de peticion. Escribe solo el visto bueno y la auditoria: no ' +
            'toca los pesos, ni el estado de calidad, ni si el pesaje esta activo. ' +
            'TAMPOCO toca el lote: aprobar el ultimo pesaje pendiente no lo mueve de etapa ni lo ' +
            'finaliza, eso se pide aparte con PATCH /lotes/{id}/finalizar/byApprover. ' +
            'Exige que el lote este cerrado y en CLIENTE_FINAL, y que el pesaje no haya sido ' +
            'revisado ya. Irreversible. NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'id', description: 'Id del pesaje a aprobar', example: 1 })
    async aprobarByApprover(
        @Param('id', ParseIntPipe) id: number,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        const aprobado = await this.pesajesService.aprobarByApprover(id, userId);
        return {
            ok: aprobado,
            msg: 'Pesaje aprobado correctamente',
        };
    }

    // Declarado al final a proposito: por encima de @Get('historial') o de
    // @Get('byLote/:loteId') se los tragaria. El orden es parte del contrato.
    @Get(':id')
    @ApiOperation({
        summary: 'Detalle de un pesaje por id',
        description:
            'Pensado para resolver el QR de una etiqueta: el frontend concatena el id escaneado. ' +
            'Devuelve los mismos campos que GET /pesajes/byLote/{loteId}, asi que la respuesta es ' +
            'intercambiable con un elemento de esa lista. ' +
            'Su UNICA condicion es el id: no filtra por estado del lote, ni por etapa, ni por ' +
            'cliente activo, de modo que devuelve pesajes de lotes cerrados, rechazados y ' +
            'finalizados que el resto de lecturas esconde. ' +
            'Un pesaje anulado no se devuelve: responde 400 con el motivo de la anulacion dentro ' +
            'del mensaje, que es el unico sitio de la API donde ese motivo es legible. ' +
            'NO valida el vinculo cliente_operador y los ids son secuenciales.',
    })
    @ApiParam({ name: 'id', description: 'Id del pesaje escaneado', example: 54 })
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const pesaje = await this.pesajesService.findOne(id);
        return {
            ok: !!pesaje,
            msg: 'Pesaje obtenido correctamente',
            pesaje,
        };
    }
}
