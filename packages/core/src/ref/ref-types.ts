/** Parsed $ref — relative path + field path within target codoc */
export interface Ref {
  /** Relative path to the codoc file, e.g. "./other.codoc" */
  path: string;
  /** Field path within the codoc, e.g. "data.field" */
  field: string;
}
