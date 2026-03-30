// JSONL (JSON Lines) parser.

export function parseJsonl(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}
