import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("browser-bundle-hygiene", () => {
  it("ensures browser and core source files do not import Node.js built-in modules", () => {
    const forbiddenModules = [
      "fs",
      "node:fs",
      "child_process",
      "node:child_process",
      "net",
      "node:net",
      "http",
      "node:http",
      "https",
      "node:https",
      "cluster",
      "node:cluster",
    ];

    const dirsToCheck = [
      path.resolve(__dirname, "../../src/core"),
      path.resolve(__dirname, "../../src/browser"),
      path.resolve(__dirname, "../../src/mobile"),
    ];

    for (const dir of dirsToCheck) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), "utf8");
        for (const mod of forbiddenModules) {
          const importPattern = new RegExp(`from\\s+["']${mod}["']`, "g");
          const requirePattern = new RegExp(`require\\(["']${mod}["']\\)`, "g");
          expect(importPattern.test(content), `Found forbidden import ${mod} in ${file}`).toBe(false);
          expect(requirePattern.test(content), `Found forbidden require ${mod} in ${file}`).toBe(false);
        }
      }
    }
  });
});
