import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register.dto';
import { LoginUserDto } from './dto/login.dto';
import { RenovarPasswordDto } from './dto/renovar-password.dto';
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
      'El token no incluye permisos ni rol: ningun endpoint valida permisos hoy. ' +
      'La respuesta 200 lleva passwordVencida: false. ' +
      'Si la contraseña es correcta pero ya vencio (password_vence_en <= NOW()), responde 403 ' +
      'con message "La contraseña ha caducado" y passwordVencida: true, sin token; ' +
      'se renueva con POST /auth/renovar-password. ' +
      'Un usuario recien registrado nace vencido y debe renovar en su primer login. ' +
      'Con una contraseña incorrecta responde 401 sin passwordVencida, este vencida o no.',
  })
  async login(@Body() data: LoginUserDto) {
    const { accessToken, currentUser } = await this.authService.login(data);
    return {
      ok: true,
      msg: 'Usuario logueado correctamente',
      user: currentUser,
      accessToken,
      passwordVencida: false,
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

  @Post('renovar-password')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: 'Renovar la contraseña',
    description:
      'Publico: no exige token, porque el login no emite uno cuando la contraseña vencio. ' +
      'Se autentica con username y password_actual, y sirve tanto para contraseñas vencidas como vigentes. ' +
      'La nueva debe tener al menos 8 caracteres, una mayuscula y un numero, y ser distinta de la actual. ' +
      'Deja la contraseña vigente por PASSWORD_VIGENCIA_DIAS dias (90 por defecto). ' +
      'No devuelve token: despues hay que llamar a POST /auth/login con la contraseña nueva. ' +
      '401 con un mismo mensaje si el usuario no existe o la contraseña actual no coincide; ' +
      '400 si la nueva no cumple las reglas o es igual a la actual.',
  })
  async renovarPassword(@Body() data: RenovarPasswordDto) {
    await this.authService.renovarPassword(data);
    return {
      ok: true,
      msg: 'Contraseña actualizada correctamente',
    };
  }
}
