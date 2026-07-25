/**
 * Augment @types/mdx's `*.mdx` module declaration with the `meta` named
 * export our legal pages carry. Without this, TypeScript rejects
 * `import Content, { meta } from "./x.mdx"` because the base type declares
 * only the default export.
 */
declare module "*.mdx" {
  const MDXComponent: (props: Record<string, unknown>) => React.ReactElement;
  export const meta: { title: string; lastUpdated: string };
  export default MDXComponent;
}
