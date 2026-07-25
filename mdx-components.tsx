import type { MDXComponents } from "mdx/types";

/**
 * Global MDX overrides. Next 16's `@next/mdx` looks up this file at the
 * project root to compose the MDX render pipeline. We keep the overrides
 * minimal for now; the LegalLayout's `.prose` wrapper handles typography.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components };
}
