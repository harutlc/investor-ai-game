import type { Logger } from 'pino';
import type { AppConfig } from '../config/AppConfig.js';
import { Database } from '../db/Database.js';
import { ApiServer } from '../http/ApiServer.js';
import type { Controller } from '../http/controllers/Controller.js';
import { CsrfController } from '../http/controllers/CsrfController.js';
import { HealthController } from '../http/controllers/HealthController.js';
import { SessionController } from '../http/controllers/SessionController.js';
import { CsrfProtection } from '../http/middleware/CsrfProtection.js';
import { PlayerSessionMiddleware } from '../http/middleware/PlayerSessionMiddleware.js';
import { LoggerFactory } from '../logging/LoggerFactory.js';
import { PlayerRepository } from '../repositories/PlayerRepository.js';
import { HealthService } from '../services/HealthService.js';
import { PlayerService, type Clock } from '../services/PlayerService.js';

export interface ContainerOverrides {
  logger?: Logger;
  database?: Database;
  clock?: Clock;
  /** Additional controllers mounted under `/api` (e.g. test-only routes). */
  extraControllers?: Controller[];
}

/** Manual DI: config → logger → database → repositories → services → middleware/controllers → server. */
export class Container {
  readonly logger: Logger;
  readonly database: Database;
  readonly playerRepository: PlayerRepository;
  readonly playerService: PlayerService;
  readonly healthService: HealthService;
  readonly server: ApiServer;

  constructor(
    readonly config: AppConfig,
    overrides: ContainerOverrides = {},
  ) {
    this.logger = overrides.logger ?? LoggerFactory.create(config);
    this.database = overrides.database ?? new Database(config.database.file);

    this.playerRepository = new PlayerRepository(this.database.db);

    this.playerService = new PlayerService(this.playerRepository, overrides.clock);
    this.healthService = new HealthService(this.database);

    const csrf = new CsrfProtection(config);
    this.server = new ApiServer({
      config,
      logger: this.logger,
      playerSession: new PlayerSessionMiddleware(config, this.playerService),
      csrf,
      health: new HealthController(this.healthService),
      controllers: [new SessionController(), new CsrfController(csrf), ...(overrides.extraControllers ?? [])],
    });
  }

  dispose(): void {
    this.database.close();
  }
}
