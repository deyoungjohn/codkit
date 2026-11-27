export { type FallbackEvent, type FallbackOptions, isTransient, withFallback } from "./fallback.js";
export { modelsFromEnv, type NamedModel, PROVIDERS, type ProviderName, type ProviderPreset } from "./providers.js";
export { generateStructured, type StructuredOptions, type StructuredResult } from "./structured.js";

import type { LanguageModelV4 } from "@ai-sdk/provider";
import { type FallbackOptions, withFallback } from "./fallback.js";
import { modelsFromEnv } from "./providers.js";

/** Every model the env provides, as one model that falls back in order: `streamText({ model: modelFromEnv(), … })`. */
export function modelFromEnv(env?: Record<string, string | undefined>, opts?: FallbackOptions): LanguageModelV4 {
  return withFallback(modelsFromEnv(env), opts);
}
