import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("consumer-smoke", () => {
  it("allows ESM dynamic imports for root and all runtime subpath exports", async () => {
    const rootMod = await import("../../src/index.js");
    expect(rootMod.BaseLogFriendsClient).toBeDefined();

    const browserMod = await import("../../src/browser/index.js");
    expect(browserMod.createBrowserClient).toBeDefined();

    const mobileMod = await import("../../src/mobile/index.js");
    expect(mobileMod.createMobileClient).toBeDefined();

    const nodeMod = await import("../../src/node/index.js");
    expect(nodeMod.createNodeClient).toBeDefined();
  });

  it("verifies built CommonJS entrypoints if dist has been compiled", () => {
    const distRoot = path.resolve(__dirname, "../../dist/index.cjs");
    const distBrowser = path.resolve(__dirname, "../../dist/browser/index.cjs");
    const distMobile = path.resolve(__dirname, "../../dist/mobile/index.cjs");
    const distNode = path.resolve(__dirname, "../../dist/node/index.cjs");

    try {
      const cjsRoot = require(distRoot);
      expect(cjsRoot.BaseLogFriendsClient).toBeDefined();

      const cjsBrowser = require(distBrowser);
      expect(cjsBrowser.createBrowserClient).toBeDefined();

      const cjsMobile = require(distMobile);
      expect(cjsMobile.createMobileClient).toBeDefined();

      const cjsNode = require(distNode);
      expect(cjsNode.createNodeClient).toBeDefined();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== "MODULE_NOT_FOUND") {
        throw e;
      }
      // If dist hasn't been built yet during initial test run, this passes
    }
  });
});
