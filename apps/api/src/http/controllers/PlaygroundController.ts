import {
  PlaygroundDecisionRequestSchema,
  PlaygroundJsonRequestSchema,
  PlaygroundTextRequestSchema,
  type DecisionResultDto,
  type PlaygroundJsonResponse,
  type PlaygroundTextResponse,
} from '@investor/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../errors/ValidationError.js';
import type { DecisionProvider } from '../../llm/decision/DecisionProvider.js';
import type { ThinkingProvider } from '../../llm/thinking/ThinkingProvider.js';
import { ValidationMiddleware } from '../middleware/ValidationMiddleware.js';
import type { Controller } from './Controller.js';

const MAX_SCHEMA_DEPTH = 10;
const MAX_SCHEMA_PROPERTIES = 50;

const textSchemas = { body: PlaygroundTextRequestSchema };
const jsonSchemas = { body: PlaygroundJsonRequestSchema };
const decisionSchemas = { body: PlaygroundDecisionRequestSchema };

/**
 * Dev-only endpoints for exercising the active providers by hand. Mounted by the Container only when
 * `dev.playground` is on and never in production; they still sit behind session, CSRF and rate limits.
 */
export class PlaygroundController implements Controller {
  readonly basePath = '/dev';

  constructor(
    private readonly thinking: ThinkingProvider,
    private readonly decision: DecisionProvider,
  ) {}

  routes(): Router {
    return Router()
      .post('/thinking/text', ValidationMiddleware.validate(textSchemas), this.text)
      .post('/thinking/json', ValidationMiddleware.validate(jsonSchemas), this.json)
      .post('/decision', ValidationMiddleware.validate(decisionSchemas), this.decide);
  }

  private readonly text = async (_req: Request, res: Response): Promise<void> => {
    const { body } = ValidationMiddleware.validated(res, textSchemas);
    const { text, provider, model, latencyMs } = await this.thinking.generateText(body);
    const response: PlaygroundTextResponse = { provider, model, text, latencyMs };
    res.json(response);
  };

  private readonly json = async (_req: Request, res: Response): Promise<void> => {
    const { body } = ValidationMiddleware.validated(res, jsonSchemas);
    const { schema: jsonSchema, ...conversation } = body;
    const schema = PlaygroundController.toZod(jsonSchema);
    const { data, provider, model, latencyMs } = await this.thinking.generateJson({
      ...conversation,
      schema,
    });
    const response: PlaygroundJsonResponse = { provider, model, data, latencyMs };
    res.json(response);
  };

  private readonly decide = async (_req: Request, res: Response): Promise<void> => {
    const { body } = ValidationMiddleware.validated(res, decisionSchemas);
    const result = await this.decision.decide(body);
    const response: DecisionResultDto = result;
    res.json(response);
  };

  /** Converts a client-supplied JSON Schema, bounding its size so it cannot be used to burn tokens. */
  private static toZod(jsonSchema: Record<string, unknown>): z.ZodType {
    const invalid = (message: string) => new ValidationError([{ path: 'body.schema', message }]);
    const { depth, properties } = PlaygroundController.measure(jsonSchema);
    if (depth > MAX_SCHEMA_DEPTH) throw invalid(`must be nested at most ${MAX_SCHEMA_DEPTH} levels deep`);
    if (properties > MAX_SCHEMA_PROPERTIES)
      throw invalid(`must declare at most ${MAX_SCHEMA_PROPERTIES} properties`);
    try {
      return z.fromJSONSchema(jsonSchema);
    } catch (error) {
      throw invalid(`is not a usable JSON Schema: ${(error as Error).message}`);
    }
  }

  /** Stops descending past the depth limit, so a deeply nested body cannot overflow the stack. */
  private static measure(node: unknown, depth = 1): { depth: number; properties: number } {
    if (node === null || typeof node !== 'object') return { depth: depth - 1, properties: 0 };
    if (depth > MAX_SCHEMA_DEPTH) return { depth, properties: 0 };
    let maxDepth = depth;
    let properties = 0;
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === 'object') {
      properties += Object.keys(record.properties).length;
    }
    for (const child of Object.values(record)) {
      const measured = PlaygroundController.measure(child, depth + 1);
      maxDepth = Math.max(maxDepth, measured.depth);
      properties += measured.properties;
    }
    return { depth: maxDepth, properties };
  }
}
