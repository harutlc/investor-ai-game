import type { Logger } from 'pino';
import { InvestorBrain } from '../brain/InvestorBrain.js';
import { mvpQuestionSets } from '../brain/mvpQuestionSets.js';
import { NegotiationStateBuilder } from '../brain/NegotiationStateBuilder.js';
import { OfferCandidateExtractor } from '../brain/OfferCandidateExtractor.js';
import { QuestionSetRegistry } from '../brain/QuestionSetRegistry.js';
import type { AppConfig } from '../config/AppConfig.js';
import { Database } from '../db/Database.js';
import { GameEngine } from '../game/GameEngine.js';
import { GameSessionMapper } from '../game/GameSessionMapper.js';
import { GameSessionService } from '../game/GameSessionService.js';
import { InvestorStateUpdater } from '../game/InvestorStateUpdater.js';
import { MeterHintMapper } from '../game/MeterHintMapper.js';
import { MoveResolver } from '../game/MoveResolver.js';
import { NegotiationPolicy } from '../game/NegotiationPolicy.js';
import { OpeningOfferCalculator } from '../game/OpeningOfferCalculator.js';
import { TurnLimiter } from '../game/TurnLimiter.js';
import { TurnLock } from '../game/TurnLock.js';
import { ApiServer } from '../http/ApiServer.js';
import type { Controller } from '../http/controllers/Controller.js';
import { CsrfController } from '../http/controllers/CsrfController.js';
import { GameController } from '../http/controllers/GameController.js';
import { HealthController } from '../http/controllers/HealthController.js';
import { PersonaController } from '../http/controllers/PersonaController.js';
import { PlaygroundController } from '../http/controllers/PlaygroundController.js';
import { SessionController } from '../http/controllers/SessionController.js';
import { CsrfProtection } from '../http/middleware/CsrfProtection.js';
import { PlayerSessionMiddleware } from '../http/middleware/PlayerSessionMiddleware.js';
import { ConfidenceGate } from '../llm/decision/ConfidenceGate.js';
import { DecisionLogger } from '../llm/decision/DecisionLogger.js';
import type { DecisionProvider } from '../llm/decision/DecisionProvider.js';
import { DecisionProviderFactory } from '../llm/decision/DecisionProviderFactory.js';
import { ProviderHealthMonitor } from '../llm/ProviderHealthMonitor.js';
import type { ThinkingProvider } from '../llm/thinking/ThinkingProvider.js';
import { ThinkingProviderFactory } from '../llm/thinking/ThinkingProviderFactory.js';
import { LoggerFactory } from '../logging/LoggerFactory.js';
import { DecisionLogRepository } from '../repositories/DecisionLogRepository.js';
import { GameSessionRepository } from '../repositories/GameSessionRepository.js';
import { MessageRepository } from '../repositories/MessageRepository.js';
import { OfferRepository } from '../repositories/OfferRepository.js';
import { PersonaCatalog } from '../personas/PersonaCatalog.js';
import { PlayerRepository } from '../repositories/PlayerRepository.js';
import { HealthService } from '../services/HealthService.js';
import { PlayerService, type Clock } from '../services/PlayerService.js';
import { ClosingGenerator } from '../voice/ClosingGenerator.js';
import { FallbackLines } from '../voice/FallbackLines.js';
import { InvestorDialogueGenerator } from '../voice/InvestorDialogueGenerator.js';
import { InvestorVoice } from '../voice/InvestorVoice.js';
import { LineWriter } from '../voice/LineWriter.js';
import { NumberConsistencyChecker } from '../voice/NumberConsistencyChecker.js';
import { NumbersInPlay } from '../voice/NumbersInPlay.js';
import { OpeningGenerator } from '../voice/OpeningGenerator.js';
import { PlayerOptionsGenerator } from '../voice/PlayerOptionsGenerator.js';
import { PromptBuilder } from '../voice/PromptBuilder.js';

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
 * Manual DI: config → logger → database → repositories → LLM providers (+ confidence gate, decision logger)
 * → investor brain → negotiation policy → investor voice → game engine → services → middleware/controllers
 * → server.
 */
export class Container {
  readonly logger: Logger;
  readonly database: Database;
  readonly playerRepository: PlayerRepository;
  readonly gameSessionRepository: GameSessionRepository;
  readonly messageRepository: MessageRepository;
  readonly offerRepository: OfferRepository;
  readonly decisionLogRepository: DecisionLogRepository;
  readonly thinkingProvider: ThinkingProvider;
  readonly decisionProvider: DecisionProvider;
  readonly providerHealth: ProviderHealthMonitor;
  readonly confidenceGate: ConfidenceGate;
  /** Decision calls made on behalf of a game session go through this, so they are logged. */
  readonly decisionLogger: DecisionLogger;
  readonly personaCatalog: PersonaCatalog;
  /** The question sets enabled by `game.features`. */
  readonly questionSetRegistry: QuestionSetRegistry;
  readonly negotiationStateBuilder: NegotiationStateBuilder;
  readonly investorBrain: InvestorBrain;
  readonly investorStateUpdater: InvestorStateUpdater;
  /** The game master: judgments + hidden numbers → the investor's action. */
  readonly negotiationPolicy: NegotiationPolicy;
  readonly meterHintMapper: MeterHintMapper;
  readonly turnLimiter: TurnLimiter;
  readonly openingOfferCalculator: OpeningOfferCalculator;
  /** The voice: lines and player options from the thinking model, number-checked by code. */
  readonly investorVoice: InvestorVoice;
  readonly gameSessionMapper: GameSessionMapper;
  /** Read side of games: the public view and the decision insights. */
  readonly gameSessionService: GameSessionService;
  readonly moveResolver: MoveResolver;
  readonly turnLock: TurnLock;
  /** Runs games: startGame() and playTurn(). */
  readonly gameEngine: GameEngine;
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
    this.gameSessionRepository = new GameSessionRepository(this.database.db, overrides.clock);
    this.messageRepository = new MessageRepository(this.database.db);
    this.offerRepository = new OfferRepository(this.database.db);
    this.decisionLogRepository = new DecisionLogRepository(this.database.db);

    const providerDeps = { logger: this.logger, ...(overrides.fetch ? { fetch: overrides.fetch } : {}) };
    this.thinkingProvider =
      overrides.thinkingProvider ?? ThinkingProviderFactory.create(config, providerDeps);
    this.decisionProvider =
      overrides.decisionProvider ?? DecisionProviderFactory.create(config, providerDeps);
    this.providerHealth = new ProviderHealthMonitor(
      { thinking: this.thinkingProvider, decision: this.decisionProvider },
      { cacheMs: config.llm.healthCacheMs, logger: this.logger },
    );
    this.confidenceGate = new ConfidenceGate(config.llm.decision.minConfidence);
    this.decisionLogger = new DecisionLogger(
      this.decisionProvider,
      this.decisionLogRepository,
      this.logger,
      overrides.clock,
    );

    // Validates every persona definition; an invalid one stops startup.
    this.personaCatalog = new PersonaCatalog();

    this.questionSetRegistry = new QuestionSetRegistry(mvpQuestionSets(), config.game.features);
    this.negotiationStateBuilder = new NegotiationStateBuilder(config.game.maxTurns);
    this.investorBrain = new InvestorBrain(
      this.questionSetRegistry,
      this.decisionLogger,
      this.confidenceGate,
    );

    this.investorStateUpdater = new InvestorStateUpdater(config.game.policy);
    this.negotiationPolicy = new NegotiationPolicy(config.game.policy, this.investorStateUpdater);
    this.meterHintMapper = new MeterHintMapper();
    this.turnLimiter = new TurnLimiter(config.game.maxTurns);
    this.openingOfferCalculator = new OpeningOfferCalculator();

    // The voice reads numbers with the brain's extractor, so both agree on what a number is.
    const extractor = new OfferCandidateExtractor();
    const prompts = new PromptBuilder();
    const numbersInPlay = new NumbersInPlay(extractor);
    const checker = new NumberConsistencyChecker(extractor);
    const lineWriter = new LineWriter(
      this.thinkingProvider,
      prompts,
      numbersInPlay,
      checker,
      new FallbackLines(),
    );
    this.investorVoice = new InvestorVoice(
      new OpeningGenerator(lineWriter),
      new ClosingGenerator(lineWriter),
      new InvestorDialogueGenerator(lineWriter),
      new PlayerOptionsGenerator(this.thinkingProvider, prompts, numbersInPlay, checker),
      this.logger,
    );

    this.gameSessionMapper = new GameSessionMapper(this.meterHintMapper, config.game.maxTurns);
    this.gameSessionService = new GameSessionService(
      this.gameSessionRepository,
      this.messageRepository,
      this.offerRepository,
      this.decisionLogRepository,
      this.personaCatalog,
      this.gameSessionMapper,
    );
    this.moveResolver = new MoveResolver(
      this.investorBrain,
      this.negotiationStateBuilder,
      this.negotiationPolicy,
    );
    this.turnLock = new TurnLock();
    this.gameEngine = new GameEngine({
      database: this.database,
      sessions: this.gameSessionRepository,
      messages: this.messageRepository,
      offers: this.offerRepository,
      personas: this.personaCatalog,
      service: this.gameSessionService,
      mapper: this.gameSessionMapper,
      resolver: this.moveResolver,
      states: this.negotiationStateBuilder,
      brain: this.investorBrain,
      policy: this.negotiationPolicy,
      limiter: this.turnLimiter,
      opening: this.openingOfferCalculator,
      voice: this.investorVoice,
      lock: this.turnLock,
      ...(overrides.clock ? { clock: overrides.clock } : {}),
    });

    this.playerService = new PlayerService(this.playerRepository, overrides.clock);
    this.healthService = new HealthService(this.database, this.providerHealth);

    const csrf = config.security.csrf.enabled ? new CsrfProtection(config) : undefined;
    const controllers: Controller[] = [
      new SessionController(),
      new PersonaController(this.personaCatalog),
      new GameController(this.gameEngine, this.gameSessionService),
    ];
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
