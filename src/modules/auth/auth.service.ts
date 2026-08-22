import { Injectable } from '@nestjs/common';
import { AuthRepository } from './repository/auth.repository';
import { RegisterUserDto } from './dto/register.dto';
import { LoginUserDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
    constructor(private readonly authRepository: AuthRepository, private readonly jwtService: JwtService) { }
    async login(data: LoginUserDto) {
        return await this.authRepository.login(data);
    }

    async registerUser(data: RegisterUserDto) {
        return await this.authRepository.registerUser(data);
    }
}
