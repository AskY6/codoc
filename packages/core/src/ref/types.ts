export interface CodocRef {
  raw: string;
  codocPath: string | null;
  pointer: string;
}

export interface NormalizedRef {
  sourceCodocId: string;
  targetCodocPath: string | null;
  targetPointer: string;
}
