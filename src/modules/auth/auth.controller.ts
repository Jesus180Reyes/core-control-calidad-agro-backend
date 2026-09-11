import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register.dto';
import { LoginUserDto } from './dto/login.dto';
import { Public } from 'src/decorators/public.decorator';

// Sin @ApiBearerAuth: los dos endpoints son @Public() y no exigen token.
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
  @Public()
  @ApiOperation({
    summary: 'Registrar un usuario',
    description:
      'Abierto: no exige token, asi que cualquiera con acceso a la API puede crear un usuario. ' +
      'La cedula es la clave natural y no puede repetirse. ' +
      'Devuelve el id del usuario creado, no el objeto usuario.',
  })
  async register(@Body() data: RegisterUserDto) {
    const user = await this.authService.registerUser(data);
    return {
      ok: true,
      msg: 'Usuario registrado correctamente',
      user,
    };

  }
}
