/**
 * Utility functions for consistent error handling across the application
 */

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class ApplicationError extends Error {
  constructor(
    message: string,
    public code?: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, field?: string, value?: unknown) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
  }
}

export class NetworkError extends ApplicationError {
  constructor(message: string, url?: string, statusCode?: number) {
    super(message, 'NETWORK_ERROR', { url, statusCode });
    this.name = 'NetworkError';
  }
}

export class DatabaseError extends ApplicationError {
  constructor(message: string, query?: string) {
    super(message, 'DATABASE_ERROR', { query });
    this.name = 'DatabaseError';
  }
}