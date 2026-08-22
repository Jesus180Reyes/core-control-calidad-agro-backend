import { Injectable, Inject, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { Kysely } from 'kysely';
import { Database } from './types/types';

@Injectable({ scope: Scope.REQUEST })
export class DatabaseService {
  public readonly client: Kysely<Database>;

  constructor(@Inject(REQUEST) private readonly request: Request) {
    this.client = this.request['db'] as Kysely<Database>;
  }
}
