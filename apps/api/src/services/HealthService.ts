import type { HealthDto } from '@inverstorm/shared';
import type { Database } from '../db/Database.js';
import type { ProviderHealthMonitor } from '../llm/ProviderHealthMonitor.js';

export class HealthService {
  constructor(
    private readonly database: Database,
    private readonly providers: ProviderHealthMonitor,
  ) {}

  /** Only the database decides `status`; provider outages are reported but never fail the probe. */
  async check(): Promise<HealthDto> {
    let database: HealthDto['checks']['database'] = 'ok';
    try {
      this.database.ping();
    } catch {
      database = 'error';
    }
    const { thinking, decision } = await this.providers.status();
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      uptime: process.uptime(),
      checks: { database, thinking, decision },
    };
  }
}
