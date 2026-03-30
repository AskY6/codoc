import type { CodocFile } from "@codoc/core";

/**
 * A Skill identifies a type of data source and knows how to
 * map individual resources (files) to codoc definitions.
 */
export interface Skill {
  /** Unique name for this skill, e.g. "claude-code-log" */
  readonly name: string;

  /**
   * Given a directory path, determine if this skill can handle it.
   * Returns true if the directory matches the expected structure.
   */
  identify(dirPath: string): Promise<boolean>;

  /**
   * Given a file path within the identified directory,
   * produce a CodocFile definition (type + data + view).
   */
  mapToCodoc(filePath: string, fileName: string): CodocFile;

  /**
   * File extension filter for the directory scan.
   * E.g. ".jsonl" for Claude Code logs.
   */
  readonly extension: string;
}
