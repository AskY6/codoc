// Raw component imports — tsup's esbuild plugin resolves `raw:` prefixed
// paths to the actual .tsx file and inlines the content as a string.

declare module "raw:*" {
  const source: string;
  export default source;
}
