import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider";
import type { LanguageModelV3 } from "@ai-sdk/provider";

export type AIProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible"
  | "ollama";

export interface AIModelConfig {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  /** Required for openai-compatible and ollama providers */
  baseUrl?: string;
  /** Optional display name for openai-compatible provider */
  providerName?: string;
}

/**
 * Create a Vercel AI SDK LanguageModel from an AIModelConfig.
 * Used by the review worker to call the configured AI provider.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAIModel(config: AIModelConfig): LanguageModelV3 {
  const { provider, model, apiKey, baseUrl, providerName } = config;

  switch (provider) {
    case "openai": {
      const openai = createOpenAI(apiKey ? { apiKey } : {});
      return openai(model);
    }

    case "anthropic": {
      const anthropic = createAnthropic(apiKey ? { apiKey } : {});
      return anthropic(model);
    }

    case "google": {
      const google = createGoogleGenerativeAI(apiKey ? { apiKey } : {});
      return google(model);
    }

    case "openai-compatible": {
      if (!baseUrl) throw new Error("baseUrl is required for openai-compatible provider");
      const compatible = createOpenAICompatible({
        name: providerName ?? "openai-compatible",
        apiKey: apiKey ?? "none",
        baseURL: baseUrl,
      });
      return compatible(model);
    }

    case "ollama": {
      const ollama = createOllama({
        baseURL: baseUrl ?? "http://localhost:11434/api",
      });
      // ollama-ai-provider returns V1; cast to satisfy return type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ollama(model) as any as LanguageModelV3;
    }

    default:
      throw new Error(`Unknown AI provider: ${provider as string}`);
  }
}

/**
 * Well-known model presets for the settings UI.
 */
export const OPENAI_REVIEW_MODELS = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "o4-mini", label: "o4-mini" },
] as const;

export const OPENAI_LIGHT_MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
] as const;
