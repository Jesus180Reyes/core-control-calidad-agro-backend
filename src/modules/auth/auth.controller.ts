import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register.dto';
import { LoginUserDto } from './dto/login.dto';
import { Public } from 'src/decorators/public.decorator';

// Sin @ApiBearerAuth a nivel de clase: login es @Public(). register si exige token
// y lo declara por metodo.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }
  @Post('login')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: 'Iniciar sesion',
    description:
      'Unico endpoint que entrega un token. Responde 200, no 201. ' +
      'El accessToken viaja en el primer nivel de la respuesta, no dentro de user. ' +
      'El token no incluye permisos ni rol: ningun endpoint valida permisos hoy.',
  })
  async login(@Body() data: LoginUserDto) {
    const { accessToken, currentUser } = await this.authService.login(data);
    return {
      ok: true,
      msg: 'Usuario logueado correctamente',
      user: currentUser,
      accessToken,
    };
  }

  @Post('register')
  @HttpCode(201)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Registrar un usuario',
    description:
      'Exige token: el usuario creado queda con created_by igual al userId del que llama. ' +
      'No discrimina por rol, asi que cualquier usuario autenticado puede crear usuarios. ' +
      'La cedula es la clave natural y no puede repetirse. ' +
      'Devuelve el id del usuario creado, no el objeto usuario.',
  })
  async register(@Body() data: RegisterUserDto, @Req() req: Request) {
    const { userId } = req.user as { userId: number };
    const user = await this.authService.registerUser(data, userId);
    return {
      ok: true,
      msg: 'Usuario registrado correctamente',
      user,
    };

  }
}
