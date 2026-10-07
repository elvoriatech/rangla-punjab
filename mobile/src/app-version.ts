import Constants from "expo-constants";

/**
 * "Version 1.1.4 · e1889ff" — the app version plus the commit the build was
 * made from (baked in by app.config.js), so the owner can tell which build is
 * on a phone (owner, 2026-10-07). Either half may be missing in a dev run.
 */
export function appVersionLabel(word: string): string {
  const version = Constants.expoConfig?.version ?? "";
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const code = typeof extra.buildCode === "string" ? extra.buildCode : "";
  return [version ? `${word} ${version}` : "", code].filter(Boolean).join(" · ");
}
