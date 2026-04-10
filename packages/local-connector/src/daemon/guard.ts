import { resolve, sep } from 'node:path'

import { ERROR_CODES, LocalConnectorError } from '../shared/errors'
import type { FilesystemPermission, SessionState } from '../shared/types'
import type { Session } from './session'

const WINDOWS_DRIVE_PREFIX_RE = /^[a-zA-Z]:[\\/]/u

function assertReadySession(state: SessionState): void {
  if (state !== 'ready') {
    throw new LocalConnectorError(ERROR_CODES.authPending, 'Session is not ready')
  }
}

export class Guard {
  checkFilesystemAccess(session: Session, relativePath: string, permission: FilesystemPermission): string {
    assertReadySession(session.state)

    const grant = session.grant
    if (!grant) {
      throw new LocalConnectorError(ERROR_CODES.accessDenied, 'No filesystem grant for this session')
    }

    if (!grant.capability.permissions.includes(permission)) {
      throw new LocalConnectorError(ERROR_CODES.accessDenied, `Permission '${permission}' not granted`)
    }

    if (typeof relativePath !== 'string') {
      throw new LocalConnectorError(ERROR_CODES.pathInvalid, 'Path must be a string')
    }

    const trimmedPath = relativePath.trim()
    if (trimmedPath.length === 0) {
      throw new LocalConnectorError(ERROR_CODES.pathInvalid, 'Path must not be empty')
    }

    if (trimmedPath.includes('\0')) {
      throw new LocalConnectorError(ERROR_CODES.pathInvalid, 'Path must not contain null bytes')
    }

    if (trimmedPath.startsWith('/') || trimmedPath.startsWith('\\') || WINDOWS_DRIVE_PREFIX_RE.test(trimmedPath)) {
      throw new LocalConnectorError(ERROR_CODES.pathInvalid, 'Absolute paths are not allowed')
    }

    if (trimmedPath === '.') {
      return resolve(grant.capability.rootPath)
    }

    const normalizedPath = trimmedPath.replace(/\\/gu, '/')
    const segments = normalizedPath.split('/')

    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new LocalConnectorError(ERROR_CODES.pathInvalid, 'Path must be a relative descendant of the granted root')
    }

    const rootPath = resolve(grant.capability.rootPath)
    const rootWithSep = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`
    const absPath = resolve(rootPath, normalizedPath)

    if (!absPath.startsWith(rootWithSep) && absPath !== rootPath) {
      throw new LocalConnectorError(ERROR_CODES.pathOutOfRoot, 'Path escapes the granted root')
    }

    return absPath
  }
}
