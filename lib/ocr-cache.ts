import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { normalizeOcrResponse, type OcrResponse } from "./ocr-types";

const FIXTURES_DIR = join(process.cwd(), "fixtures", "ocr");

/** Writable OCR cache dir — `/tmp` on Vercel (read-only FS elsewhere). */
export function getOcrWritableCacheDir(): string {
  if (process.env.OCR_CACHE_DIR?.trim()) {
    return process.env.OCR_CACHE_DIR.trim();
  }
  if (process.env.VERCEL === "1") {
    return join(tmpdir(), "formless-ocr-cache");
  }
  return join(process.cwd(), ".ocr-cache");
}

/** Fixture aliases keyed by ocrCacheKey(fileName) → fixtures/ocr/{alias}.json */
const FIXTURE_ALIASES: Record<string, string> = {
  Gesellschaftsvertrag_Midgley_Tech_EU_FlexCo: "elizabeth-flexco",
};

/** True when OCR_MOCK is 1 / true / yes — serve from fixtures or .ocr-cache only. */
export function isOcrMockEnabled(): boolean {
  const value = process.env.OCR_MOCK?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function ocrCacheKey(fileName: string): string {
  const base = basename(fileName.trim());
  const withoutExt = base.replace(/\.[^.]+$/, "");
  return withoutExt || base;
}

export function ocrCachePath(fileName: string): string {
  return join(getOcrWritableCacheDir(), `${ocrCacheKey(fileName)}.json`);
}

function fixturePaths(fileName: string): string[] {
  const key = ocrCacheKey(fileName);
  const alias = FIXTURE_ALIASES[key];
  const paths = [
    join(FIXTURES_DIR, `${key}.json`),
    alias ? join(FIXTURES_DIR, `${alias}.json`) : null,
    ocrCachePath(fileName),
  ].filter((path): path is string => Boolean(path));

  return paths;
}

function readJsonFixture(path: string): OcrResponse | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return normalizeOcrResponse(raw);
  } catch {
    return null;
  }
}

/** Load a cached OCR response keyed by upload filename (basename, extension stripped). */
export function readOcrCache(fileName: string): OcrResponse | null {
  for (const path of fixturePaths(fileName)) {
    const cached = readJsonFixture(path);
    if (cached) {
      return cached;
    }
  }

  return null;
}

const SHA256_BASENAME = /^[a-f0-9]{64}$/i;

/** True when a cache basename looks like a content hash rather than a filename stem. */
export function isOcrHashCacheBasename(basename: string): boolean {
  return SHA256_BASENAME.test(basename);
}

/** Fixture path for a committed OCR mock (`fixtures/ocr/<ocrCacheKey>.json`). */
export function ocrFixturePath(fileName: string): string {
  return join(FIXTURES_DIR, `${ocrCacheKey(fileName)}.json`);
}

/**
 * Resolve the mock lookup key for a cache file on disk.
 * Filename-keyed caches use the basename; hash-keyed caches need sourceFileName in JSON or --for.
 */
export function resolveOcrPromoteTargetKey(
  cacheFilePath: string,
  raw: Record<string, unknown>,
  forFileName?: string,
): string {
  if (forFileName?.trim()) {
    return ocrCacheKey(forFileName);
  }

  const sourceFileName = raw.sourceFileName;
  if (typeof sourceFileName === "string" && sourceFileName.trim()) {
    return ocrCacheKey(sourceFileName);
  }

  const stem = basename(cacheFilePath).replace(/\.json$/i, "");
  if (!isOcrHashCacheBasename(stem)) {
    return stem;
  }

  throw new Error(
    `Hash-named cache "${stem}" — pass the upload filename: ` +
      `bun run scripts/promote-ocr-cache.ts ${cacheFilePath} Robert_Stevens_sample_case.pdf`,
  );
}

/**
 * Best-effort persist of a live OCR response (filename key, not a hash).
 * Never throws — returns the path written, or null if the FS is read-only.
 */
export function writeOcrCache(fileName: string, data: OcrResponse): string | null {
  try {
    const cacheDir = getOcrWritableCacheDir();
    mkdirSync(cacheDir, { recursive: true });
    const path = join(cacheDir, `${ocrCacheKey(fileName)}.json`);
    const payload = {
      ...data,
      sourceFileName: basename(fileName.trim()),
    };
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return path;
  } catch {
    return null;
  }
}
