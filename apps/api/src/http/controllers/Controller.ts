import type { Router } from 'express';

/** An HTTP controller: maps routes under `basePath` (relative to `/api`) to service calls. */
export interface Controller {
  readonly basePath: string;
  routes(): Router;
}
