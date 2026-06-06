import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { normalizeOcrResponse, type OcrResponse } from "./ocr-types";

const CACHE_DIR = join(process.cwd(), ".ocr-cache");

/** True when OCR_MOCK is 1 / true / yes — serve from .ocr-cache only. */
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
  return join(CACHE_DIR, `${ocrCacheKey(fileName)}.json`);
}

/** Load a cached OCR response keyed by upload filename (basename, extension stripped). */
export function readOcrCache(fileName: string): OcrResponse | null {
  const path = ocrCachePath(fileName);
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
