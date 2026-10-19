import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OrigenesService } from './origenes.service';
import { CreateOrigenDto } from './dto/create-origen.dto';

@ApiTags('origenes')
@ApiBearerAuth()
@Controller('origenes')
export class OrigenesController {
    constructor(private readonly origenesService: OrigenesService) { }

    @Post()
    @HttpCode(201)
    @ApiOperation({
        summary: 'Registrar un origen de lotes',
        description:
            'Da de alta un origen (finca o proveedor) en el catalogo GLOBAL de origenes, ' +
            'compartido por todos los clientes: un origen no pertenece a ningun cliente y ' +
            'cualquier cliente puede usarlo en sus lotes. Solo nombre es obligatorio; ' +
            'direccion y telefono son opcionales y, si no se tienen, no se mandan (null o ' +
            'cadena vacia responden 400). ' +
            'El nombre no se repite en todo el catalogo: la comparacion no distingue ' +
            'mayusculas ni tildes y cuenta tambien los origenes inactivos, asi que un nombre ' +
            'repetido responde 400. ' +
            'Devuelve el id creado en origen_id, para que el front pueda preseleccionarlo. ' +
            'No hay forma de editar ni desactivar un origen por API: se hace a mano en MySQL. ' +
            'NO valida el vinculo cliente_operador ni el rol: cualquier usuario autenticado ' +
            'puede crear origenes.',
    })
    async create(@Body() dto: CreateOrigenDto, @Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const origen_id = await this.origenesService.create(dto, userId);
        return {
            ok: !!origen_id,
            msg: 'Origen creado correctamente',
            origen_id,
        };
    }
}
