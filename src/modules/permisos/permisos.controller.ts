import { Controller, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PermisosService } from './permisos.service';

@ApiTags('permisos')
@ApiBearerAuth()
@Controller('permisos')
export class PermisosController {
    constructor(private readonly permisosService: PermisosService) { }

    @Get('me')
    @ApiOperation({
        summary: 'Permisos del usuario autenticado',
        description:
            'Devuelve los codigos de permiso del rol del usuario del token, como un array plano ' +
            'de strings y sin orden garantizado. El rol se resuelve desde el userId del token, ' +
            'asi que no hay forma de pedir los permisos de otro usuario. ' +
            'INFORMATIVO: ningun endpoint de la API valida permisos todavia. Sirve para que el ' +
            'cliente esconda botones, no para autorizar nada.',
    })
    async findMisPermisos(@Req() req: Request) {
        const { userId } = req.user as { userId: number };
        const permisos = await this.permisosService.findMisPermisos(userId);
        return {
            ok: true,
            msg: 'Permisos obtenidos correctamente',
            permisos,
        };
    }
}
