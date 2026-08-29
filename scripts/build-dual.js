import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const rootDir = path.resolve(".");
const distDir = path.join(rootDir, "dist");
const distCjsDir = path.join(rootDir, "dist-cjs");

// 1. Clean dist directories
if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true });
if (fs.existsSync(distCjsDir)) fs.rmSync(distCjsDir, { recursive: true, force: true });

// 2. Build ESM
console.log("Compiling ESM...");
execSync("npx tsc -p tsconfig.build.json", { stdio: "inherit" });

// 3. Build CommonJS
console.log("Compiling CommonJS...");
execSync("npx tsc -p tsconfig.cjs.json", { stdio: "inherit" });

// 4. Merge CJS into dist with .cjs and .d.cts extensions
function mergeCjsFiles(srcDir, targetDir) {
  if (!fs.existsSync(srcDir)) return;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true });
      mergeCjsFiles(srcPath, targetPath);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".js")) {
        let content = fs.readFileSync(srcPath, "utf8");
        // Ensure relative require paths ending with .js or .cjs work
        content = content.replace(/require\(["'](\.[^"']+)\.js["']\)/g, 'require("$1.cjs")');
        const cjsTarget = path.join(targetDir, entry.name.slice(0, -3) + ".cjs");
        fs.writeFileSync(cjsTarget, content, "utf8");
      } else if (entry.name.endsWith(".d.ts")) {
        let dtsContent = fs.readFileSync(srcPath, "utf8");
        dtsContent = dtsContent.replace(/from\s+["'](\.[^"']+)\.js["']/g, 'from "$1.cjs"');
        const dctsTarget = path.join(targetDir, entry.name.slice(0, -5) + ".d.cts");
        fs.writeFileSync(dctsTarget, dtsContent, "utf8");
      }
    }
  }
}

mergeCjsFiles(distCjsDir, distDir);

// 5. Clean up temp dist-cjs
fs.rmSync(distCjsDir, { recursive: true, force: true });

console.log("Built dual ESM (.js / .d.ts) and CommonJS (.cjs / .d.cts) successfully.");
