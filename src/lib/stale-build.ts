/**
 * Errors that mean "this tab is running an older build than the server":
 * a Server Action id the new deployment does not know, or a script chunk
 * that no longer exists. Neither is fixed by retrying — only by reloading
 * the page, which the root error boundaries do once, automatically.
 */
export function isStaleBuildError(message: string | undefined | null): boolean {
  if (!message) return false;
  return /Failed to find Server Action|ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|older or newer deployment/i.test(
    message,
  );
}
