import { DatabaseService } from "src/database/database.service";
import { RegisterUserDto } from "../dto/register.dto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { LoginUserDto } from "../dto/login.dto";
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { JwtService } from "@nestjs/jwt";
import { JwtPayload } from "src/strategy/jwt.stategy";
import { ConfigService } from "@nestjs/config";
import { Kysely, sql } from "kysely";
import { Database } from "src/database/types/types";
import { RenovarPasswordDto } from "../dto/renovar-password.dto";
@Injectable()
export class AuthRepository {
    private readonly SALT_ROUNDS = 10;
    private static readonly VIGENCIA_POR_DEFECTO_DIAS = 90;
    private static readonly LARGO_PASSWORD_TEMPORAL = 10;
    private static readonly MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    private static readonly NUMEROS = '23456789';
    private static readonly ALFABETO = `${AuthRepository.MAYUSCULAS}abcdefghijkmnpqrstuvwxyz${AuthRepository.NUMEROS}`;
    constructor(
        private readonly dbService: DatabaseService,
        private readonly jwtService: JwtService,
        private readonly config: ConfigService,
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

        if (user.password_vencida) {
            throw new ForbiddenException({
                statusCode: 403,
                message: 'La contraseña ha caducado',
                passwordVencida: true,
            });
        }

        const payload: JwtPayload = {
            sub: user.id,
            user_id: user.id,
            username: user.username!,
        }
        const accessToken = this.jwtService.sign(payload);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password: _, id: __, cedula: ____, username: _____, password_vencida: ______, ...currentUser } = user;

        return {
            accessToken,
            currentUser,
        };
    }
    async registerUser(data: RegisterUserDto, createdBy: number) {

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
                password_vence_en: sql`NOW()`,
                created_by: createdBy,
                cedula,
            })
            .executeTakeFirstOrThrow();

        return Number(result.insertId);

    }

    async renovarPassword(data: RenovarPasswordDto) {
        const { username, password_actual, password_nueva } = data;
        const dias = this.resolverVigenciaDias();

        return await this.db.transaction().execute(async (trx) => {
            const user = await this.validateCredenciales(username, password_actual, trx);
            await this.validatePasswordDistinta(password_nueva, user.password);

            const hashedPassword = await bcrypt.hash(password_nueva, this.SALT_ROUNDS);

            await trx
                .updateTable('usuarios')
                .set({
                    password: hashedPassword,
                    password_actualizada_en: sql`NOW()`,
                    password_vence_en: sql`DATE_ADD(NOW(), INTERVAL ${dias} DAY)`,
                })
                .where('id', '=', user.id)
                .executeTakeFirstOrThrow();

            return true;
        });
    }

    private async validateCredenciales(username: string, password: string, db: Kysely<Database>) {
        const user = await db
            .selectFrom('usuarios')
            .select(['id', 'password'])
            .where('username', '=', username)
            .executeTakeFirst();

        const isPasswordValid = user ? await bcrypt.compare(password, user.password) : false;
        if (!user || !isPasswordValid) {
            throw new UnauthorizedException('Usuario o contraseña incorrectos');
        }
        return user;
    }

    private async validatePasswordDistinta(passwordNueva: string, hashActual: string) {
        const esIgual = await bcrypt.compare(passwordNueva, hashActual);
        if (esIgual) {
            throw new BadRequestException('La nueva contraseña debe ser distinta de la actual');
        }
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
                sql<number>`usuarios.password_vence_en IS NOT NULL AND usuarios.password_vence_en <= NOW()`.as('password_vencida'),
            ])
            .where('username', '=', username)
            .executeTakeFirst();
        return user;
    }

    /**
     * `PASSWORD_VIGENCIA_DIAS` es opcional. Un valor que no sea un entero
     * positivo cae a 90, igual que `GEMINI_TIMEOUT_MS` en `GeminiService`: no
     * hay forma de apagar el vencimiento por configuracion. Tiene que ser
     * entero porque va interpolado en un `INTERVAL ... DAY`.
     */
    private resolverVigenciaDias(): number {
        const crudo = this.config.get<string>('PASSWORD_VIGENCIA_DIAS');
        const valor = Number(crudo);
        return Number.isInteger(valor) && valor > 0
            ? valor
            : AuthRepository.VIGENCIA_POR_DEFECTO_DIAS;
    }

    /**
     * Contraseña temporal del reset por admin (spec 34). Sin caracteres
     * ambiguos (0 O o 1 l I) para que se pueda dictar, y con al menos una
     * mayuscula y un numero garantizados: se toman primero, se completa con el
     * alfabeto entero y se mezclan las posiciones con Fisher-Yates.
     */
    private generarPasswordTemporal(): string {
        const caracteres = [
            AuthRepository.MAYUSCULAS[randomInt(AuthRepository.MAYUSCULAS.length)],
            AuthRepository.NUMEROS[randomInt(AuthRepository.NUMEROS.length)],
        ];
        while (caracteres.length < AuthRepository.LARGO_PASSWORD_TEMPORAL) {
            caracteres.push(AuthRepository.ALFABETO[randomInt(AuthRepository.ALFABETO.length)]);
        }
        for (let i = caracteres.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
        }
        return caracteres.join('');
    }

}