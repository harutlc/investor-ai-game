import type { HealthDto } from '@inverstorm/shared';
import type { Database } from '../db/Database.js';

export class HealthService {
  constructor(private readonly database: Database) {}

  check(): HealthDto {
    let database: HealthDto['checks']['database'] = 'ok';
    try {
      this.database.ping();
    } catch {
      database = 'error';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      uptime: process.uptime(),
      checks: { database },
    };
  }
}
