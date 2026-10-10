import { Body, Controller, HttpCode, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register.dto';
import { LoginUserDto } from './dto/login.dto';
import { RenovarPasswordDto } from './dto/renovar-password.dto';
import { Public } from 'src/decorators/public.decorator';

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
      'Exige rol ADMIN, leido de la base en cada request; cualquier otro rol, o un token cuyo usuario ya no existe, responde 403. ' +
      'El usuario creado queda con created_by igual al userId del que llama. Un admin puede crear otro admin. ' +
      'El body no lleva contraseña: el sistema genera una temporal de 10 caracteres y la devuelve en password_temporal una sola vez; no se guarda en texto plano. ' +
      'La temporal nace vencida: el login con ella responde 403 con passwordVencida: true, ' +
      'y el usuario debe renovarla con POST /auth/renovar-password. ' +
      'En user devuelve el id del usuario creado, no el objeto usuario. ' +
      '400 si el rol no existe; 409 si la cedula ya esta registrada; ' +
      '400 si el username ya esta en uso (sin distinguir mayusculas) o excede 20 caracteres.',
  })
  async register(@Body() data: RegisterUserDto, @Req() req: Request) {
    const { userId } = req.user as { userId: number };
    const { id, passwordTemporal } = await this.authService.registerUser(data, userId);
    return {
      ok: true,
      msg: 'Usuario registrado correctamente',
      user: id,
      password_temporal: passwordTemporal,
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

  @Patch('usuarios/:id/reset-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'Id del usuario cuya contraseña se restablece', example: 1 })
  @ApiOperation({
    summary: 'Restablecer la contraseña de un usuario',
    description:
      'Exige rol ADMIN, leido de la base en cada request: es el unico endpoint del proyecto que discrimina por rol. ' +
      'Cualquier otro rol, o un token cuyo usuario ya no existe, responde 403. ' +
      'Genera una contraseña temporal de 10 caracteres y la devuelve en password_temporal una sola vez; no se guarda en texto plano. ' +
      'La temporal nace vencida: el login con ella responde 403 con passwordVencida: true, ' +
      'y el usuario debe renovarla con POST /auth/renovar-password. ' +
      'No acepta body. Un admin puede resetear a otro admin pero no a si mismo (400). ' +
      '400 si el usuario no existe o esta inactivo. ' +
      'No revoca los tokens vigentes del usuario reseteado.',
  })
  async resetearPassword(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const { userId } = req.user as { userId: number };
    const passwordTemporal = await this.authService.resetearPassword(id, userId);
    return {
      ok: true,
      msg: 'Contraseña restablecida correctamente',
      password_temporal: passwordTemporal,
    };
  }

  @Patch('usuarios/:id/pin')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'Id del usuario SUPERVISOR al que se asigna el PIN', example: 1 })
  @ApiOperation({
    summary: 'Asignar el PIN de un supervisor',
    description:
      'Exige rol ADMIN, leido de la base en cada request; cualquier otro rol, o un token cuyo usuario ya no existe, responde 403, ' +
      'y se valida antes que el id, asi que no revela que usuarios son supervisores. ' +
      'El usuario destino debe tener rol SUPERVISOR. ' +
      'El sistema genera un PIN de 4 digitos unico en todo el sistema y lo devuelve en pin una sola vez; ninguna otra respuesta lo devuelve. ' +
      'El PIN se guarda en claro. Se asigna una vez y para siempre: no se regenera, cambia ni revoca por API. ' +
      'No acepta body. ' +
      '400 si el usuario no existe, esta inactivo, no tiene el rol SUPERVISOR o ya tiene un PIN asignado.',
  })
  async asignarPinSupervisor(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const { userId } = req.user as { userId: number };
    const pin = await this.authService.asignarPinSupervisor(id, userId);
    return {
      ok: true,
      msg: 'PIN asignado correctamente',
      pin,
    };
  }
}
