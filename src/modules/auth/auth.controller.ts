import { Body, Controller, HttpCode, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register.dto';
import { LoginUserDto } from './dto/login.dto';
import { RenovarPasswordDto } from './dto/renovar-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
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
      'Entrega el par de tokens; POST /auth/refresh lo renueva. Responde 200, no 201. ' +
      'accessToken (8h) y refreshToken (30 dias) viajan en el primer nivel de la respuesta, no dentro de user. ' +
      'refreshToken es null si el servidor no tiene JWT_REFRESH_SECRET configurado: ' +
      'entonces no hay renovacion y al vencer el accessToken hay que volver a hacer login. ' +
      'El token no incluye permisos ni rol: ningun endpoint valida permisos hoy. ' +
      'La respuesta 200 lleva passwordVencida: false. ' +
      'Si la contraseña es correcta pero ya vencio (password_vence_en <= NOW()), responde 403 ' +
      'con message "La contraseña ha caducado" y passwordVencida: true, sin token; ' +
      'se renueva con POST /auth/renovar-password. ' +
      'Un usuario recien registrado nace vencido y debe renovar en su primer login. ' +
      'Con una contraseña incorrecta responde 401 sin passwordVencida, este vencida o no. ' +
      'Un usuario con isActive = 0 y la contraseña correcta responde 401 "El usuario esta inactivo"; ' +
      'con la contraseña incorrecta recibe el 401 de credenciales, sin revelar que esta inactivo.',
  })
  async login(@Body() data: LoginUserDto) {
    const { accessToken, refreshToken, currentUser } = await this.authService.login(data);
    return {
      ok: true,
      msg: 'Usuario logueado correctamente',
      user: currentUser,
      accessToken,
      refreshToken,
      passwordVencida: false,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: 'Renovar la sesion con el refresh token',
    description:
      'Canjea el refreshToken de POST /auth/login (o de un refresh anterior) por un par nuevo: ' +
      'accessToken de 8h y refreshToken de 30 dias contados desde esta llamada (sesion deslizante). ' +
      'Responde 200, no 201. Publica: no lleva Bearer, el token viaja en el body { refreshToken }. ' +
      'Un refreshToken no sirve como Bearer en las demas rutas, ni un accessToken sirve aqui: se firman con secretos distintos. ' +
      'El refreshToken anterior NO se invalida al rotar: sigue valiendo hasta su propio vencimiento. ' +
      'No devuelve user. Consulta usuarios en cada llamada, y el username del token nuevo sale de la base. ' +
      'Errores, en este orden: 503 "El refresh de sesion no esta disponible" si el servidor no tiene JWT_REFRESH_SECRET; ' +
      '400 si falta refreshToken o viene vacio; ' +
      '401 "Refresh token inválido o expirado" si la firma no es valida, el token vencio, esta mal formado, es un accessToken o su usuario ya no existe; ' +
      '401 "El usuario esta inactivo" si el usuario tiene isActive = 0; ' +
      '403 con message "La contraseña ha caducado" y passwordVencida: true si la contraseña vencio, igual que el login.',
  })
  async refresh(@Body() data: RefreshTokenDto) {
    const { accessToken, refreshToken } = await this.authService.refresh(data.refreshToken);
    return {
      ok: true,
      msg: 'Sesion renovada correctamente',
      accessToken,
      refreshToken,
    };
  }

  @Post('register')
  @HttpCode(201)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Registrar un usuario',
    description:
      'Exige rol ADMIN o SOPORTE, leido de la base en cada request; cualquier otro rol, o un token cuyo usuario ya no existe, responde 403. ' +
      'El usuario creado queda con created_by igual al userId del que llama. Un ADMIN o un SOPORTE puede crear un usuario de cualquier rol, ADMIN incluido. ' +
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
      'Exige rol ADMIN o SOPORTE, leido de la base en cada request. ' +
      'Cualquier otro rol, o un token cuyo usuario ya no existe, responde 403. ' +
      'Genera una contraseña temporal de 10 caracteres y la devuelve en password_temporal una sola vez; no se guarda en texto plano. ' +
      'La temporal nace vencida: el login con ella responde 403 con passwordVencida: true, ' +
      'y el usuario debe renovarla con POST /auth/renovar-password. ' +
      'No acepta body. Un ADMIN o un SOPORTE puede resetear a cualquier usuario, ADMIN incluido, pero no a si mismo (400). ' +
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
      'Exige rol ADMIN o SOPORTE, leido de la base en cada request; cualquier otro rol, o un token cuyo usuario ya no existe, responde 403, ' +
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
