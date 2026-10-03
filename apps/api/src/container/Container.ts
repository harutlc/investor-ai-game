import type { Logger } from 'pino';
import type { AppConfig } from '../config/AppConfig.js';
import { Database } from '../db/Database.js';
import { ApiServer } from '../http/ApiServer.js';
import type { Controller } from '../http/controllers/Controller.js';
import { CsrfController } from '../http/controllers/CsrfController.js';
import { HealthController } from '../http/controllers/HealthController.js';
import { PlaygroundController } from '../http/controllers/PlaygroundController.js';
import { SessionController } from '../http/controllers/SessionController.js';
import { CsrfProtection } from '../http/middleware/CsrfProtection.js';
import { PlayerSessionMiddleware } from '../http/middleware/PlayerSessionMiddleware.js';
import type { DecisionProvider } from '../llm/decision/DecisionProvider.js';
import { DecisionProviderFactory } from '../llm/decision/DecisionProviderFactory.js';
import { ProviderHealthMonitor } from '../llm/ProviderHealthMonitor.js';
import type { ThinkingProvider } from '../llm/thinking/ThinkingProvider.js';
import { ThinkingProviderFactory } from '../llm/thinking/ThinkingProviderFactory.js';
import { LoggerFactory } from '../logging/LoggerFactory.js';
import { PlayerRepository } from '../repositories/PlayerRepository.js';
import { HealthService } from '../services/HealthService.js';
import { PlayerService, type Clock } from '../services/PlayerService.js';

export interface ContainerOverrides {
  logger?: Logger;
  database?: Database;
  clock?: Clock;
  thinkingProvider?: ThinkingProvider;
  decisionProvider?: DecisionProvider;
  /** Transport for the real providers (tests stub it). */
  fetch?: typeof globalThis.fetch;
  /** Additional controllers mounted under `/api` (e.g. test-only routes). */
  extraControllers?: Controller[];
}

/**
 * Manual DI: config → logger → database → repositories → LLM providers → services → middleware/controllers
 * → server.
 */
export class Container {
  readonly logger: Logger;
  readonly database: Database;
  readonly playerRepository: PlayerRepository;
  readonly thinkingProvider: ThinkingProvider;
  readonly decisionProvider: DecisionProvider;
  readonly providerHealth: ProviderHealthMonitor;
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

    const providerDeps = { logger: this.logger, ...(overrides.fetch ? { fetch: overrides.fetch } : {}) };
    this.thinkingProvider =
      overrides.thinkingProvider ?? ThinkingProviderFactory.create(config, providerDeps);
    this.decisionProvider =
      overrides.decisionProvider ?? DecisionProviderFactory.create(config, providerDeps);
    this.providerHealth = new ProviderHealthMonitor(
      { thinking: this.thinkingProvider, decision: this.decisionProvider },
      { cacheMs: config.llm.healthCacheMs, logger: this.logger },
    );

    this.playerService = new PlayerService(this.playerRepository, overrides.clock);
    this.healthService = new HealthService(this.database, this.providerHealth);

    const csrf = config.security.csrf.enabled ? new CsrfProtection(config) : undefined;
    const controllers: Controller[] = [new SessionController()];
    // Without CSRF there is no token to hand out, so GET /api/csrf-token is simply not mounted (404).
    if (csrf) controllers.push(new CsrfController(csrf));
    // Hard production gate: the playground spends real provider money and must never be exposed there.
    if (config.dev.playground && !config.isProduction) {
      controllers.push(new PlaygroundController(this.thinkingProvider, this.decisionProvider));
    }
    controllers.push(...(overrides.extraControllers ?? []));

    this.server = new ApiServer({
      config,
      logger: this.logger,
      playerSession: new PlayerSessionMiddleware(config, this.playerService),
      csrf,
      health: new HealthController(this.healthService),
      controllers,
    });
  }

  dispose(): void {
    this.database.close();
  }
}
