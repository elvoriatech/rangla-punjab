import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBuildInfo } from "./build-info";

/**
 * The point of this module is that it answers even when nothing stamped it —
 * an operator page must not 500 because a build arg was forgotten, and a dev
 * server has no build step at all. So the fallbacks are the contract.
 */

describe("getBuildInfo", () => {
  const saved = { sha: process.env.GIT_SHA, time: process.env.BUILD_TIME };

  beforeEach(() => {
    delete process.env.GIT_SHA;
    delete process.env.BUILD_TIME;
  });

  afterEach(() => {
    if (saved.sha === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = saved.sha;
    if (saved.time === undefined) delete process.env.BUILD_TIME;
    else process.env.BUILD_TIME = saved.time;
  });

  it("reads 'dev' with no build time when nothing is stamped", () => {
    const info = getBuildInfo();
    expect(info.commit).toBe("dev");
    expect(info.builtAt).toBeNull();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(info.label).toBe(`${info.version} · dev`);
  });

  it("uses the stamped commit and formats the build time for a human", () => {
    process.env.GIT_SHA = "1ab0722";
    process.env.BUILD_TIME = "2026-09-18T10:41:07Z";
    const info = getBuildInfo();
    expect(info.commit).toBe("1ab0722");
    expect(info.builtAt).toBe("2026-09-18T10:41:07Z");
    expect(info.label).toBe(`${info.version} · 1ab0722 · 2026-09-18 10:41 UTC`);
  });

  it("treats a declared-but-empty build arg as absent", () => {
    // `--build-arg GIT_SHA=` and an unset ARG both arrive as "" here; neither
    // should render as a blank commit next to the word "Commit".
    process.env.GIT_SHA = "   ";
    process.env.BUILD_TIME = "";
    const info = getBuildInfo();
    expect(info.commit).toBe("dev");
    expect(info.builtAt).toBeNull();
  });

  it("shows an unparseable build time verbatim rather than dropping it", () => {
    // Chasing a bad deploy, a visibly wrong stamp beats a silently missing one.
    process.env.GIT_SHA = "abc1234";
    process.env.BUILD_TIME = "not-a-date";
    const info = getBuildInfo();
    expect(info.builtAt).toBe("not-a-date");
    expect(info.label).toContain("not-a-date");
  });
});
