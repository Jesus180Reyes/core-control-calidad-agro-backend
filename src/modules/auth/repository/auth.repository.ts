import { DatabaseService } from "src/database/database.service";
import { RegisterUserDto } from "../dto/register.dto";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { LoginUserDto } from "../dto/login.dto";
import * as bcrypt from 'bcrypt';
import { JwtService } from "@nestjs/jwt";
import { JwtPayload } from "src/strategy/jwt.stategy";
@Injectable()
export class AuthRepository {
    private readonly SALT_ROUNDS = 10;
    constructor(
        private readonly dbService: DatabaseService,
        private readonly jwtService: JwtService,
    ) { }


    get db() {
        return this.dbService.client;
    }
    async login(data: LoginUserDto) {
        const { username, password } = data;
        const user = await this.getUserByUsername(username);
        if (!user) {
            throw new UnauthorizedException('Usuario o contraseña incorrectos');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Usuario o contraseña incorrectas');
        }
        const payload: JwtPayload = {
            sub: user.id,
            user_id: user.id,
            username: user.username!,
        }
        const accessToken = this.jwtService.sign(payload);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password: _, id: __, cedula: ____, username: _____, ...currentUser } = user;

        return {
            accessToken,
            currentUser,
        };
    }
    async registerUser(data: RegisterUserDto) {

        const { complete_name, password, rol, username, cedula } = data;

        const user = await this.getUserByCedula(cedula);
        const hashedPassword = await bcrypt.hash(password, this.SALT_ROUNDS);

        if (user) {
            throw new ConflictException(`El usuario con '${cedula}' ya existe registrado`);
        }

        const result = await this.db
            .insertInto('usuarios')
            .values({
                username,
                complete_name,
                rol_id: rol,
                password: hashedPassword,
                created_by: 1,
                cedula,
            })
            .executeTakeFirstOrThrow();

        return Number(result.insertId);

    }

    async getUserByCedula(cedula: string) {
        const user = await this.db
            .selectFrom('usuarios')
            .selectAll()
            .where('cedula', '=', cedula)

            .executeTakeFirst();
        return user;
    }
    async getUserByUsername(username: string) {
        const user = await this.db
            .selectFrom('usuarios')
            .innerJoin('roles', 'roles.id', 'usuarios.rol_id')
            .select([
                'usuarios.id',
                'usuarios.cedula',
                'usuarios.username',
                'usuarios.complete_name',
                'usuarios.password',
                'roles.nombre as rol',
            ])
            .where('username', '=', username)
            .executeTakeFirst();
        return user;
    }

}