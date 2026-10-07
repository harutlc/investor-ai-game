import {
  CreateGameRequestSchema,
  PlayTurnRequestSchema,
  type DecisionInsightsDto,
  type GameListDto,
  type GameSessionDto,
  type TurnResultDto,
} from '@investor/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { GameEngine } from '../../game/GameEngine.js';
import type { GameSessionService } from '../../game/GameSessionService.js';
import { ValidationMiddleware } from '../middleware/ValidationMiddleware.js';
import type { Controller } from './Controller.js';

const gameParams = z.object({ id: z.uuid() });
const createSchemas = { body: CreateGameRequestSchema };
const readSchemas = { params: gameParams };
const turnSchemas = { params: gameParams, body: PlayTurnRequestSchema };

/**
 * `/api/games`: start, list and read games, play turns, read the decision log. A thin layer over the
 * engine: every rule (ownership, finished games, one turn at a time) lives there. Responses are private,
 * changing game state, so they are never cached.
 */
export class GameController implements Controller {
  readonly basePath = '/games';

  constructor(
    private readonly engine: GameEngine,
    private readonly games: GameSessionService,
  ) {}

  routes(): Router {
    return Router()
      .get('/', this.list)
      .post('/', ValidationMiddleware.validate(createSchemas), this.start)
      .get('/:id', ValidationMiddleware.validate(readSchemas), this.get)
      .post('/:id/turns', ValidationMiddleware.validate(turnSchemas), this.turn)
      .get('/:id/insights', ValidationMiddleware.validate(readSchemas), this.insights);
  }

  private readonly list = async (req: Request, res: Response): Promise<void> => {
    const body: GameListDto = await this.games.listSessions(GameController.playerId(req));
    GameController.send(res, 200, body);
  };

  private readonly start = async (req: Request, res: Response): Promise<void> => {
    const { body } = ValidationMiddleware.validated(res, createSchemas);
    const game: GameSessionDto = await this.engine.startGame(GameController.playerId(req), body);
    GameController.send(res, 201, game);
  };

  private readonly get = async (req: Request, res: Response): Promise<void> => {
    const { params } = ValidationMiddleware.validated(res, readSchemas);
    const game: GameSessionDto = await this.games.getSession(GameController.playerId(req), params.id);
    GameController.send(res, 200, game);
  };

  private readonly turn = async (req: Request, res: Response): Promise<void> => {
    const { params, body } = ValidationMiddleware.validated(res, turnSchemas);
    const result: TurnResultDto = await this.engine.playTurn(GameController.playerId(req), params.id, body);
    GameController.send(res, 200, result);
  };

  private readonly insights = async (req: Request, res: Response): Promise<void> => {
    const { params } = ValidationMiddleware.validated(res, readSchemas);
    const body: DecisionInsightsDto = await this.games.getInsights(GameController.playerId(req), params.id);
    GameController.send(res, 200, body);
  };

  private static playerId(req: Request): string {
    if (!req.player) throw new Error('GameController requires PlayerSessionMiddleware');
    return req.player.id;
  }

  private static send(res: Response, status: number, body: unknown): void {
    res.status(status).set('Cache-Control', 'no-store').json(body);
  }
}
