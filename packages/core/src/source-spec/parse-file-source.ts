import { parse as parseYaml } from "yaml";

import type { FileSourceSpec } from "./types.js";

export function parseFileSourceContent(
  format: FileSourceSpec["format"],
  text: string
): unknown {
  switch (format) {
    case "json":
      return JSON.parse(text);
    case "yaml":
      return parseYaml(text);
    case "csv":
      return parseCsv(text);
    case "text":
      return text;
  }
}

function parseCsv(text: string): Array<Record<string, string>> | string[][] {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvRow);

  if (rows.length === 0) {
    return [];
  }

  const header = rows[0];
  if (!header) {
    return [];
  }

  const body = rows.slice(1);
  if (header.every((cell) => cell.length > 0) && body.length > 0) {
    return body.map((row) =>
      Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""]))
    );
  }

  return rows;
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}
