/**
 * Promote a live `.ocr-cache` entry into `fixtures/ocr/` for OCR_MOCK offline use.
 *
 * Usage:
 *   bun run scripts/promote-ocr-cache.ts .ocr-cache/Robert_Stevens_sample_case.json
 *   bun run scripts/promote-ocr-cache.ts .ocr-cache/<sha256>.json Robert_Stevens_sample_case.pdf
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  ocrCacheKey,
  ocrFixturePath,
  resolveOcrPromoteTargetKey,
} from "../lib/ocr-cache";

function usage(): never {
  console.error(
    "Usage: bun run scripts/promote-ocr-cache.ts <.ocr-cache/file.json> [upload-filename.pdf]",
  );
  process.exit(1);
}

function main(): void {
  const cacheArg = process.argv[2];
  if (!cacheArg) {
    usage();
  }

  const cachePath = resolve(process.cwd(), cacheArg);
  if (!existsSync(cachePath)) {
    console.error(`Cache file not found: ${cachePath}`);
    process.exit(1);
  }

  const forFileName = process.argv[3];
  const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>;
  const targetKey = resolveOcrPromoteTargetKey(cachePath, raw, forFileName);
  const lookupFileName = forFileName?.trim()
    ? basename(forFileName.trim())
    : typeof raw.sourceFileName === "string" && raw.sourceFileName.trim()
      ? basename(raw.sourceFileName.trim())
      : `${targetKey}.pdf`;

  const fixturePath = ocrFixturePath(lookupFileName);
  mkdirSync(join(process.cwd(), "fixtures", "ocr"), { recursive: true });
  writeFileSync(fixturePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  console.log(`Promoted ${cachePath}`);
  console.log(`Mock lookup key: ${targetKey} (ocrCacheKey("${lookupFileName}"))`);
  console.log(`Fixture path: ${fixturePath}`);
  console.log(
    `OCR_MOCK=1 will resolve uploads named "${lookupFileName}" from fixtures/ocr/${targetKey}.json`,
  );
}

main();
