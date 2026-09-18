import pkg from "../../package.json";

/**
 * What is actually running right now.
 *
 * `package.json`'s version answers "which release line" and has sat at 0.1.0
 * since the fork, so on its own it cannot tell an operator whether a deploy
 * landed. The commit can: it is stamped into the image at build time
 * (Dockerfile ARG → ENV, passed by `deploy/deploy.sh build`), so it describes
 * the bytes in the container rather than the checkout on the build host.
 *
 * Deliberately NOT `NEXT_PUBLIC_`: the commit is operator information, shown
 * on /admin/system. Shipping it in the client bundle would hand every guest a
 * precise pointer to the source tree for no benefit.
 *
 * Falls back to "dev" rather than throwing — `pnpm dev` has no build step, and
 * a missing stamp must never be the reason a page 500s.
 */

export interface BuildInfo {
  /** Release line from package.json, e.g. "0.1.0". */
  version: string;
  /** Short commit the image was built from, or "dev" outside a built image. */
  commit: string;
  /** ISO timestamp of the build, or null when unstamped. */
  builtAt: string | null;
  /** One line for an operator: `0.1.0 · 1ab0722 · 2026-09-18 10:41 UTC`. */
  label: string;
}

/** Trim + reject the empty string, so a build arg that was declared but never
 *  passed reads as absent rather than as a blank commit. */
function present(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

export function getBuildInfo(): BuildInfo {
  const version = pkg.version;
  const commit = present(process.env.GIT_SHA) ?? "dev";
  const builtAtRaw = present(process.env.BUILD_TIME);

  // Show a malformed stamp as-is instead of silently dropping it: an operator
  // chasing a bad deploy is better served by "2026-13-45" than by nothing.
  let builtAtLabel = builtAtRaw;
  if (builtAtRaw) {
    const d = new Date(builtAtRaw);
    if (!Number.isNaN(d.getTime())) {
      builtAtLabel = `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    }
  }

  return {
    version,
    commit,
    builtAt: builtAtRaw,
    label: [version, commit, builtAtLabel].filter(Boolean).join(" · "),
  };
}
