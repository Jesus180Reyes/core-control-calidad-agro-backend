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
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { DocumentosFiscalesService } from './documentos-fiscales.service';
import { CreateDocumentoFiscalDto } from './dto/create-documento-fiscal.dto';
import { FiltrosDocumentosFiscalesDto } from './dto/filtros-documentos-fiscales.dto';
import { CompletarDocumentoFiscalDto } from './dto/completar-documento-fiscal.dto';
import { AnularDocumentoFiscalDto } from './dto/anular-documento-fiscal.dto';

@ApiTags('documentos-fiscales')
@ApiBearerAuth()
@Controller('documentos-fiscales')
export class DocumentosFiscalesController {
    constructor(
        private readonly documentosFiscalesService: DocumentosFiscalesService,
    ) { }

    @Get()
    @ApiOperation({
        summary: 'Listado de documentos fiscales',
        description:
            'Documentos fiscales activos, con el cliente y su RTN resueltos por INNER JOIN y el ' +
            'codigo del pais. NO trae impuestos ni lotes: para eso esta el detalle. ' +
            'Los tres filtros son opcionales y se combinan con AND. Un valor invalido se ignora, ' +
            'nunca devuelve 400. hasta es inclusivo del dia, porque fecha_emision es DATE. ' +
            'isActive = 1 se aplica siempre y ningun parametro lo levanta: los documentos anulados ' +
            'no se listan, solo se ven por el detalle. Ordena por fecha_emision DESC y desempata ' +
            'por id DESC. Sin paginacion. ' +
            'NO valida el vinculo cliente_operador: cualquier usuario autenticado ve los documentos ' +
            'de todos los clientes.',
    })
    async findAll(@Query() filtros: FiltrosDocumentosFiscalesDto) {
        const documentos = await this.documentosFiscalesService.findAll(filtros);
        return {
            ok: !!documentos,
            msg: 'Documentos fiscales obtenidos correctamente',
            documentos,
        };
    }

    @Post()
    @HttpCode(201)
    @ApiOperation({
        summary: 'Registrar un documento fiscal',
        description:
            'Registra una factura emitida FUERA del sistema y la amarra a los lotes finalizados que ' +
            'la respaldan. El sistema NO emite: no genera correlativo, no genera autorizacion, no ' +
            'calcula impuesto y no produce PDF. Cabecera, impuestos y lotes se insertan en UNA sola ' +
            'transaccion. ' +
            'pais_id es opcional: si se omite se resuelve al unico pais activo de paises_config, y ' +
            'con dos o mas activos responde 400 pidiendo el campo. moneda tambien es opcional y ' +
            'cae a la del pais. ' +
            'El formato de numero_completo NO lo valida el DTO sino el repositorio, contra ' +
            'paises_config.patron_numero, porque depende del pais. Lo mismo autorizacion, que se ' +
            'exige solo si requiere_autorizacion es 1. ' +
            'Cada lote debe existir, pertenecer al cliente, estar en la etapa FINALIZADO y no estar ' +
            'ya vinculado a un documento activo. El total debe cuadrar con la suma de importes, con ' +
            'tolerancia de un centavo. ' +
            'documento_aduanero y archivo_url NO se aceptan aqui: llegan despues, por completar. ' +
            'NO valida el vinculo cliente_operador.',
    })
    async create(@Body() dto: CreateDocumentoFiscalDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const documento_id = await this.documentosFiscalesService.create(
            dto,
            userId,
        );
        return {
            ok: !!documento_id,
            msg: 'Documento fiscal registrado correctamente',
            documento_id,
        };
    }

    @Patch(':id/completar')
    @ApiOperation({
        summary: 'Completar un documento fiscal',
        description:
            'Escribe documento_aduanero y archivo_url, los dos unicos campos que llegan despues del ' +
            'registro: el documento aduanero cierra cuando cierra aduana, no cuando se emite la ' +
            'factura. Ambos son opcionales pero hay que mandar al menos uno. ' +
            'Cada campo se escribe UNA sola vez: si la columna ya tiene valor responde 400, y el ' +
            'otro campo puede completarse por separado. ' +
            'Es la unica escritura del proyecto que actualiza un campo que no es de auditoria ni de ' +
            'ciclo de vida. El resto no se corrige: se anula y se registra de nuevo. ' +
            'Responde { ok, msg } sin payload del recurso. 400 si el documento no existe, si esta ' +
            'anulado, o si el campo enviado ya fue completado. ' +
            'NO valida el vinculo cliente_operador.',
    })
    @ApiParam({ name: 'id', description: 'Id del documento fiscal', example: 1 })
    async completar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: CompletarDocumentoFiscalDto,
    ) {
        await this.documentosFiscalesService.completar(id, dto);
        return {
            ok: true,
            msg: 'Documento fiscal completado correctamente',
        };
    }

    @Patch(':id/anular')
    @ApiOperation({
        summary: 'Anular un documento fiscal',
        description:
            'Anulacion logica: isActive = 0 mas el motivo y la auditoria de quien y cuando. El ' +
            'cuerpo es un motivo obligatorio de 5 a 255 caracteres, como los cinco rechazar del ' +
            'proyecto. Responde { ok, msg } sin payload del recurso. ' +
            'NO borra las filas hijas: los impuestos y los lotes del documento quedan donde estan. ' +
            'Se anula el documento, no se destruye la evidencia. ' +
            'Anular LIBERA los lotes, que vuelven a poder facturarse en otro documento, pero NO ' +
            'libera el numero: el UNIQUE (pais_id, numero_completo) lo sigue ocupando. ' +
            'El documento desaparece del listado y sigue visible por el detalle. Irreversible: ' +
            'no hay forma de deshacerlo. 400 si el documento no existe o ya fue anulado. ' +
            'NO valida el vinculo cliente_operador: cualquier usuario autenticado puede anular ' +
            'un documento de cualquier cliente.',
    })
    @ApiParam({ name: 'id', description: 'Id del documento fiscal', example: 1 })
    async anular(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: AnularDocumentoFiscalDto,
        @Req() req: Request,
    ) {
        const { userId } = req.user as { userId: number };
        await this.documentosFiscalesService.anular(id, dto, userId);
        return {
            ok: true,
            msg: 'Documento fiscal anulado correctamente',
        };
    }

    // Declarado ULTIMO a proposito: Nest resuelve por orden de declaracion, y
    // un @Get(':id') por encima de @Get() o de los dos @Patch se los tragaria.
    @Get(':id')
    @ApiOperation({
        summary: 'Detalle de un documento fiscal',
        description:
            'El endpoint de auditoria: la cabecera, su cliente, su pais, sus impuestos, sus lotes y, ' +
            'por cada lote, la trazabilidad fisica que lo respalda: nombre del lote, producto, ' +
            'unidad de medida, quien aprobo y quien finalizo resueltos a nombre completo con sus ' +
            'fechas, el conteo de pesajes activos y la suma de su peso neto. ' +
            'Del pais devuelve codigo_pais y las dos etiquetas, para que el frontend rotule CAI o ' +
            'NIT sin conocer el pais. ' +
            'Devuelve el documento AUNQUE ESTE ANULADO, con isActive 0, su motivo_anulacion y quien ' +
            'lo anulo. Se aparta a proposito de GET /pesajes/:id, donde un pesaje anulado responde ' +
            '400: una lectura que existe para auditar no puede esconder lo anulado. ' +
            '404 si el id no existe; un id no numerico responde 400 del ParseIntPipe. ' +
            'NO valida el vinculo cliente_operador, y el id es secuencial.',
    })
    @ApiParam({ name: 'id', description: 'Id del documento fiscal', example: 1 })
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const documento = await this.documentosFiscalesService.findOne(id);
        return {
            ok: !!documento,
            msg: 'Documento fiscal obtenido correctamente',
            documento,
        };
    }
}
