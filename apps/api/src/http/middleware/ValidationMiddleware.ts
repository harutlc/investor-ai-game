import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { ValidationError, type ValidationIssue } from '../../errors/ValidationError.js';

type Part = 'body' | 'params' | 'query';
export type RequestSchemas = Partial<Record<Part, z.ZodType>>;
export type Validated<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

/**
 * Validates body/params/query with zod before the handler runs. Object schemas are made strict so unknown
 * fields are rejected. Parsed values go to `res.locals.validated` (Express 5 makes `req.query` read-only).
 */
export class ValidationMiddleware {
  static validate(schemas: RequestSchemas): RequestHandler {
    const strict = Object.fromEntries(
      Object.entries(schemas).map(([part, schema]) => [
        part,
        schema instanceof z.ZodObject ? schema.strict() : schema,
      ]),
    ) as RequestSchemas;

    return (req: Request, res: Response, next: NextFunction): void => {
      const issues: ValidationIssue[] = [];
      const validated: Partial<Record<Part, unknown>> = {};
      for (const part of ['params', 'query', 'body'] as const) {
        const schema = strict[part];
        if (!schema) continue;
        const result = schema.safeParse(req[part]);
        if (result.success) {
          validated[part] = result.data;
        } else {
          for (const issue of result.error.issues) {
            const keys = issue.code === 'unrecognized_keys' ? issue.keys : [undefined];
            for (const key of keys) {
              const segments = [part, ...issue.path.map(String), ...(key === undefined ? [] : [key])];
              issues.push({ path: segments.join('.'), message: issue.message });
            }
          }
        }
      }
      if (issues.length > 0) {
        next(new ValidationError(issues));
        return;
      }
      res.locals.validated = validated;
      next();
    };
  }

  /** Typed access to the values validated for `schemas`. */
  static validated<S extends RequestSchemas>(res: Response, _schemas: S): Validated<S> {
    return res.locals.validated as Validated<S>;
  }
}
