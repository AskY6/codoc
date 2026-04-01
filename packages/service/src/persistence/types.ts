import type { ParsedCodoc } from "@cobook/core";

export interface CodocStore {
  load(root: string, fallbackCodocs: Map<string, ParsedCodoc>): Promise<Map<string, ParsedCodoc>>;
  readContent(root: string, codocId: string, filePath: string): Promise<string | null>;
  write(
    root: string,
    input: {
      codocId: string;
      filePath: string;
      content: string;
      overwrite?: boolean;
    }
  ): Promise<void>;
  importFile(root: string, filePath: string): Promise<ParsedCodoc>;
}
