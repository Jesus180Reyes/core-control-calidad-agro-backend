import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PermisosService } from './permisos.service';

@Controller('permisos')
export class PermisosController {
    constructor(private readonly permisosService: PermisosService) { }

    @Get('me')
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
