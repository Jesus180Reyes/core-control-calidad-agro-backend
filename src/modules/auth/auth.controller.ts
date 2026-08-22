import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register.dto';
import { LoginUserDto } from './dto/login.dto';
import { Public } from 'src/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }
  @Post('login')
  @HttpCode(200)
  @Public()
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
  async register(@Body() data: RegisterUserDto) {
    const user = await this.authService.registerUser(data);
    return {
      ok: true,
      msg: 'Usuario registrado correctamente',
      user,
    };

  }
}
