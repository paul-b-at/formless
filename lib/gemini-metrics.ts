/** In-process counter for engine Gemini calls (testing / replay metrics). */
let engineGeminiCallCount = 0;

export function resetEngineGeminiCallCount(): void {
  engineGeminiCallCount = 0;
}

export function recordEngineGeminiCall(): void {
  engineGeminiCallCount += 1;
}

export function getEngineGeminiCallCount(): number {
  return engineGeminiCallCount;
}
