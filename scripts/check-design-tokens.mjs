#!/usr/bin/env node
/**
 * Design-token guard (runs as part of `pnpm lint`).
 *
 * Fails if source files contain
 *   - raw HEX colors outside packages/ui/src/styles/tokens.css, or
 *   - Tailwind arbitrary values like `bg-[#fff]`, `p-[13px]`, `aspect-[4/3]`, or
 *   - named widths like `max-w-2xl` (removed by the theme, they silently do nothing).
 * Design values must come from tokens (see docs/design-system.md).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const scanRoots = ["apps", "packages"];
const extensions = [".ts", ".tsx", ".css"];
const allowedFiles = new Set([join("packages", "ui", "src", "styles", "tokens.css")]);
const ignoredDirs = new Set(["node_modules", ".next", ".turbo", "coverage", "dist"]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const ARBITRARY = /(?<![\w-])[a-z][\w:-]*-\[[^\]\s]+\]/g;
// Tailwind's named container sizes are removed by the theme – such classes silently do nothing.
const NAMED_WIDTH =
  /(?<![\w-])(?:[a-z]+:)*(?:max-|min-)?w-(?:3xs|2xs|xs|sm|md|lg|xl|[2-7]xl)(?![\w-])/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const violations = [];
for (const scanRoot of scanRoots) {
  for (const file of walk(join(root, scanRoot))) {
    const rel = relative(root, file);
    if (!rel.split(sep).includes("src")) continue;
    if (!extensions.some((ext) => rel.endsWith(ext))) continue;
    if (allowedFiles.has(rel) || /\.test\.tsx?$/.test(rel)) continue;

    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const match of line.matchAll(HEX)) {
          violations.push(`${rel}:${index + 1}  raw color "${match[0]}" – use a design token`);
        }
        if (!rel.endsWith(".css")) {
          for (const match of line.matchAll(ARBITRARY)) {
            violations.push(
              `${rel}:${index + 1}  arbitrary value "${match[0]}" – use a design token`,
            );
          }
          for (const match of line.matchAll(NAMED_WIDTH)) {
            violations.push(
              `${rel}:${index + 1}  "${match[0]}" does not exist in the theme – use a width token (reading, content, wide) or the spacing scale`,
            );
          }
        }
      });
  }
}

if (violations.length > 0) {
  console.error(`Design-token check failed (${violations.length}):\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("Design-token check passed.");
