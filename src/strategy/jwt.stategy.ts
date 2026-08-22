// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
export interface JwtPayload {
    sub: number;
    user_id: number;
    username: string;
    iat?: number;
    exp?: number;
}
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET || 'SUPER_SECRET_KEY_PROD',
        });
    }

    validate(payload: JwtPayload) {
        if (!payload || (!payload.sub && !payload.user_id)) {
            throw new UnauthorizedException('El token no contiene una identidad válida');
        }

        if (payload.exp && Date.now() >= payload.exp * 1000) {
            throw new UnauthorizedException('El token ha expirado');
        }

        return {
            userId: payload.user_id ?? payload.sub,
            username: payload.username,
        };
    }
}