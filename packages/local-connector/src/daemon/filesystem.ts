import { readdir, readFile, stat } from 'node:fs/promises'

import { DEFAULT_MAX_TEXT_FILE_BYTES, type ReadDirEntry, type ReadFileResult } from '../shared/types'
import { ERROR_CODES, LocalConnectorError } from '../shared/errors'

function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024))
  return !sample.includes(0)
}

export class FilesystemCapability {
  constructor(private readonly maxTextFileBytes = DEFAULT_MAX_TEXT_FILE_BYTES) {}

  async readTextFile(absPath: string): Promise<ReadFileResult> {
    let info

    try {
      info = await stat(absPath)
    } catch {
      throw new LocalConnectorError(ERROR_CODES.fileNotFound, 'File not found')
    }

    if (!info.isFile()) {
      throw new LocalConnectorError(ERROR_CODES.fileNotFound, 'Path is not a file')
    }

    if (info.size > this.maxTextFileBytes) {
      throw new LocalConnectorError(ERROR_CODES.fileTooLarge, 'File exceeds the maximum supported size')
    }

    const content = await readFile(absPath)
    if (!isProbablyText(content)) {
      throw new LocalConnectorError(ERROR_CODES.fileNotText, 'Only text files are supported in Phase 1')
    }

    return {
      content: content.toString('utf8'),
      encoding: 'utf-8',
      size: info.size,
      mtimeMs: info.mtimeMs
    }
  }

  async readDirectory(absPath: string): Promise<ReadDirEntry[]> {
    try {
      const entries = await readdir(absPath, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file'
      }))
    } catch {
      throw new LocalConnectorError(ERROR_CODES.fileNotFound, 'Directory not found')
    }
  }
}
