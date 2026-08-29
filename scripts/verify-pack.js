import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(".");

const requiredFiles = [
  "README.md",
  "LICENSE",
  "package.json",
  "dist/index.js",
  "dist/index.cjs",
  "dist/index.d.ts",
  "dist/index.d.cts",
  "dist/browser/index.js",
  "dist/browser/index.cjs",
  "dist/browser/index.d.ts",
  "dist/browser/index.d.cts",
  "dist/mobile/index.js",
  "dist/mobile/index.cjs",
  "dist/mobile/index.d.ts",
  "dist/mobile/index.d.cts",
  "dist/node/index.js",
  "dist/node/index.cjs",
  "dist/node/index.d.ts",
  "dist/node/index.d.cts",
  "dist/decorators/index.js",
  "dist/decorators/index.cjs",
  "dist/decorators/index.d.ts",
  "dist/decorators/index.d.cts",
  "dist/schema/index.js",
  "dist/schema/index.cjs",
  "dist/schema/index.d.ts",
  "dist/schema/index.d.cts",
  "dist/discovery/index.js",
  "dist/discovery/index.cjs",
  "dist/discovery/index.d.ts",
  "dist/discovery/index.d.cts",
];

console.log("Verifying npm package files...");

const missing = [];
for (const relPath of requiredFiles) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    missing.push(relPath);
  }
}

if (missing.length > 0) {
  console.error("❌ Package verification failed! Missing required publish files:");
  for (const m of missing) {
    console.error(`  - ${m}`);
  }
  process.exit(1);
}

// Verify package.json exports
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
if (!pkg.publishConfig || pkg.publishConfig.access !== "public") {
  console.error("❌ package.json must include publishConfig.access = 'public'");
  process.exit(1);
}

if (!pkg.files || !pkg.files.includes("dist") || !pkg.files.includes("LICENSE")) {
  console.error("❌ package.json files array must include 'dist' and 'LICENSE'");
  process.exit(1);
}

console.log("✅ All required npm package files and exports verified successfully.");
