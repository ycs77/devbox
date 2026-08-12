export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DevboxError }

export type DevboxError = UsageError | ValidationError | OperationalError

interface ErrorData {
  readonly code: string
  readonly observed: string
  readonly nextAction: string
}

export interface UsageError extends ErrorData {
  readonly kind: 'usage'
}

export interface ValidationError extends ErrorData {
  readonly kind: 'validation'
}

export interface OperationalError extends ErrorData {
  readonly kind: 'operational'
}

export function success<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function failure<T>(error: DevboxError): Result<T> {
  return { ok: false, error }
}
