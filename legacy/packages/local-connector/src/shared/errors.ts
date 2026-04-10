export const ERROR_CODES = {
  unauthorizedOrigin: 'ERR_UNAUTHORIZED_ORIGIN',
  invalidHello: 'ERR_INVALID_HELLO',
  authPending: 'ERR_AUTH_PENDING',
  accessDenied: 'ERR_ACCESS_DENIED',
  pathInvalid: 'ERR_PATH_INVALID',
  pathOutOfRoot: 'ERR_PATH_OUT_OF_ROOT',
  unsupportedOperation: 'ERR_UNSUPPORTED_OPERATION',
  daemonUnavailable: 'ERR_DAEMON_UNAVAILABLE',
  fileNotFound: 'ERR_FILE_NOT_FOUND',
  fileTooLarge: 'ERR_FILE_TOO_LARGE',
  fileNotText: 'ERR_FILE_NOT_TEXT',
  internal: 'ERR_INTERNAL'
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export class LocalConnectorError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'LocalConnectorError'
  }
}

export function toErrorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof LocalConnectorError) {
    return { code: error.code, message: error.message }
  }

  if (error instanceof Error) {
    return { code: ERROR_CODES.internal, message: error.message }
  }

  return { code: ERROR_CODES.internal, message: 'Unknown error' }
}
