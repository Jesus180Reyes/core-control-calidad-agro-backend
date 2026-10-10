import { Injectable } from '@nestjs/common';
import { AuthRepository } from './repository/auth.repository';
import { RegisterUserDto } from './dto/register.dto';
import { LoginUserDto } from './dto/login.dto';
import { RenovarPasswordDto } from './dto/renovar-password.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
    constructor(private readonly authRepository: AuthRepository, private readonly jwtService: JwtService) { }
    async login(data: LoginUserDto) {
        return await this.authRepository.login(data);
    }

    async registerUser(data: RegisterUserDto, userId: number) {
        return await this.authRepository.registerUser(data, userId);
    }

    async renovarPassword(data: RenovarPasswordDto) {
        return await this.authRepository.renovarPassword(data);
    }

    async resetearPassword(id: number, userId: number) {
        return await this.authRepository.resetearPassword(id, userId);
    }
}
