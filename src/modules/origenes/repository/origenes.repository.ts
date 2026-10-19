import { DatabaseService } from 'src/database/database.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Database } from 'src/database/types/types';
import { CreateOrigenDto } from '../dto/create-origen.dto';

@Injectable()
export class OrigenesRepository {
    constructor(private readonly dbService: DatabaseService) { }

    get db() {
        return this.dbService.client;
    }

    async createOrigen(data: CreateOrigenDto, userId: number) {
        const { nombre, direccion, telefono } = data;

        return await this.db.transaction().execute(async (trx) => {
            await this.validateNombreOrigenDisponible(nombre, trx);

            const result = await trx
                .insertInto('origenes')
                .values({
                    nombre,
                    direccion,
                    telefono,
                    created_by: userId,
                })
                .executeTakeFirstOrThrow(
                    () => new BadRequestException('Error al crear el origen'),
                );

            return Number(result.insertId);
        });
    }

    // SPEC 43: unicidad global, solo en codigo (no hay UNIQUE en MySQL). No filtra
    // isActive, asi reactivar uno a mano nunca deja dos con el mismo nombre. La
    // collation utf8mb4_0900_ai_ci hace la comparacion sin mayusculas ni tildes.
    private async validateNombreOrigenDisponible(
        nombre: string,
        db: Kysely<Database>,
    ) {
        const existente = await db
            .selectFrom('origenes')
            .select('id')
            .where('nombre', '=', nombre)
            .executeTakeFirst();

        if (existente) {
            throw new BadRequestException(
                `El origen '${nombre}' ya esta registrado`,
            );
        }
    }
}
