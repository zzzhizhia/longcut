import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ProviderAdapter, ProviderGenerateParams, ProviderGenerateResult } from './types';

const PROVIDER_NAME = 'claude';
const MODEL_CASCADE = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
] as const;

type ClaudeModel = (typeof MODEL_CASCADE)[number];

function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('503') ||
    lower.includes('529') ||
    lower.includes('overloaded') ||
    lower.includes('rate_limit') ||
    lower.includes('service unavailable')
  );
}

function getNextModel(current: string): ClaudeModel | null {
  const idx = MODEL_CASCADE.indexOf(current as ClaudeModel);
  if (idx < 0 || idx >= MODEL_CASCADE.length - 1) return null;
  return MODEL_CASCADE[idx + 1];
}

async function callClaude(
  prompt: string,
  model: string,
  params: ProviderGenerateParams,
): Promise<ProviderGenerateResult> {
  const abortController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (params.timeoutMs && params.timeoutMs > 0) {
    timeout = setTimeout(() => abortController.abort(), params.timeoutMs);
  }

  try {
    const systemPrompt = buildSystemPrompt(params);

    const options: Record<string, unknown> = {
      model,
      systemPrompt,
      allowedTools: [],
      maxTurns: 1,
      abortController,
    };

    if (params.zodSchema) {
      try {
        const jsonSchema = z.toJSONSchema(params.zodSchema);
        options.outputFormat = {
          type: 'json_schema',
          schema: jsonSchema,
        };
      } catch (schemaError) {
        console.warn('[Claude] Failed to convert Zod schema, falling back to prompt injection', schemaError);
        // Fallback: no outputFormat, rely on prompt instructions
      }
    }

    let resultContent = '';
    let structuredOutput: unknown = undefined;
    let usage: ProviderGenerateResult['usage'] = undefined;
    let resultModel: string | undefined;

    const startTime = Date.now();

    for await (const message of query({ prompt, options: options as any })) {
      if (message.type === 'assistant') {
        // Collect text from assistant messages
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && 'text' in block && typeof block.text === 'string') {
              resultContent += block.text;
            }
          }
        }
        resultModel = message.message?.model;
      } else if (message.type === 'result') {
        const latencyMs = Date.now() - startTime;

        if (message.subtype === 'success') {
          // Prefer structured_output if available
          if (message.structured_output !== undefined) {
            structuredOutput = message.structured_output;
          }
          // Use result text as fallback content
          if (!resultContent && message.result) {
            resultContent = message.result;
          }

          const rawUsage = message.usage;
          usage = {
            promptTokens: rawUsage?.input_tokens,
            completionTokens: rawUsage?.output_tokens,
            totalTokens:
              typeof rawUsage?.input_tokens === 'number' && typeof rawUsage?.output_tokens === 'number'
                ? rawUsage.input_tokens + rawUsage.output_tokens
                : undefined,
            latencyMs,
          };
        } else {
          // Error result
          const errors = 'errors' in message ? (message.errors as string[]) : [];
          throw new Error(
            `Claude query failed (${message.subtype}): ${errors.join(', ') || 'unknown error'}`
          );
        }
      }
    }

    // If we have structured output, serialize it as the content
    const finalContent = structuredOutput !== undefined
      ? JSON.stringify(structuredOutput)
      : resultContent;

    if (!finalContent) {
      throw new Error('Claude API returned an empty response.');
    }

    return {
      content: finalContent,
      rawResponse: structuredOutput ?? resultContent,
      provider: PROVIDER_NAME,
      model: resultModel ?? model,
      usage,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Claude request timed out.');
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildSystemPrompt(params: ProviderGenerateParams): string {
  const parts: string[] = [
    'You are a helpful AI assistant. Respond directly to the user\'s request.',
    'Do NOT use any tools. Provide your response as text only.',
  ];

  if (params.zodSchema && !params.metadata?.hasOutputFormat) {
    parts.push(
      'IMPORTANT: Respond with valid JSON only. No markdown, no code fences, no explanation outside the JSON.'
    );
  }

  if (typeof params.temperature === 'number') {
    // temperature is handled by the model, but note it for the system
  }

  return parts.join('\n');
}

export function createClaudeAdapter(): ProviderAdapter {
  // Uses local Claude Code authentication via @anthropic-ai/claude-agent-sdk
  // No ANTHROPIC_API_KEY needed when running locally

  return {
    name: PROVIDER_NAME,
    defaultModel: MODEL_CASCADE[0],
    async generate(params: ProviderGenerateParams): Promise<ProviderGenerateResult> {
      // Ignore non-Claude model names passed from caller (e.g. grok models)
      const isClaudeModel = params.model && MODEL_CASCADE.includes(params.model as ClaudeModel);
      const startModel = isClaudeModel ? (params.model as ClaudeModel) : MODEL_CASCADE[0];
      let currentModel: string = startModel;

      while (true) {
        try {
          console.log(`[Claude] Trying model: ${currentModel}`);
          return await callClaude(params.prompt, currentModel, params);
        } catch (error) {
          if (isRetryableError(error)) {
            const next = getNextModel(currentModel);
            if (next) {
              console.warn(
                `[Claude] ${currentModel} failed with retryable error, cascading to ${next}`
              );
              currentModel = next;
              continue;
            }
          }
          throw error;
        }
      }
    },
  };
}
