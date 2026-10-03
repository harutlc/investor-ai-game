import { ErrorCode } from '@investor/shared';
import { AppError } from './AppError.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends AppError {
  constructor(issues: ValidationIssue[], message = 'Request validation failed') {
    super(400, ErrorCode.VALIDATION_ERROR, message, issues);
  }
}
