import { NextRequest, NextResponse } from 'next/server';
import { getTranslationClient } from '@/lib/translation';
import { z } from 'zod';
import type { TranslationContext } from '@/lib/translation/types';

const translationContextSchema = z.object({
  scenario: z.enum(['transcript', 'chat', 'topic', 'general']).optional(),
  videoTitle: z.string().optional(),
  topicKeywords: z.array(z.string()).optional(),
  preserveFormatting: z.boolean().optional(),
}).optional() satisfies z.ZodType<TranslationContext | undefined>;

const MAX_TEXT_LENGTH = 10000; // max chars per text segment
const MAX_TOTAL_CHARS = 500000; // max total chars across all texts

const translateBatchRequestSchema = z.object({
  texts: z.array(z.string().max(MAX_TEXT_LENGTH, `Each text must be under ${MAX_TEXT_LENGTH} characters`)),
  targetLanguage: z.string().default('zh-CN'),
  context: translationContextSchema
});

async function handler(request: NextRequest) {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
    const body = requestBody;

    const validation = translateBatchRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid request format',
          details: validation.error.flatten()
        },
        { status: 400 }
      );
    }

    const { texts, targetLanguage, context } = validation.data;

    if (texts.length === 0) {
      return NextResponse.json({ translations: [] });
    }

    const MAX_REQUEST_TEXTS = 10000;
    if (texts.length > MAX_REQUEST_TEXTS) {
      return NextResponse.json(
        { error: `Batch size too large. Maximum ${MAX_REQUEST_TEXTS} texts allowed.` },
        { status: 400 }
      );
    }

    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return NextResponse.json(
        { error: `Total text size too large. Maximum ${MAX_TOTAL_CHARS} characters allowed.` },
        { status: 400 }
      );
    }

    // Internally chunk into safe sizes and process with limited concurrency
    const translationClient = getTranslationClient();

    const CHUNK_SIZE = 100; // keep provider calls reasonable
    const CONCURRENCY = 6; // increased from 4 for faster parallel processing

    function chunk<T>(arr: T[], size: number): T[][] {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    }

    const chunks = chunk(texts, CHUNK_SIZE);
    const results: string[] = new Array(texts.length);

    // Run with basic concurrency control
    let index = 0;
    async function worker() {
      // Add random jitter (0-100ms) to prevent thundering herd
      await new Promise(r => setTimeout(r, Math.random() * 100));

      while (index < chunks.length) {
        const myIndex = index++;
        const translated = await translationClient.translateBatch(
          chunks[myIndex],
          targetLanguage,
          context
        );
        // place back preserving order
        const start = myIndex * CHUNK_SIZE;
        for (let i = 0; i < translated.length; i++) {
          results[start + i] = translated[i];
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker());
    await Promise.all(workers);

    return NextResponse.json({ translations: results });
  } catch (error) {
    // Log full error details server-side for debugging
    console.error('[TRANSLATE] Translation error:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestBody: requestBody || 'Unable to parse request body',
      timestamp: new Date().toISOString()
    });

    // Provide more specific error messages based on error type
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        return NextResponse.json(
          { error: 'Translation service configuration error' },
          { status: 500 }
        );
      }
      if (error.message.includes('quota') || error.message.includes('limit')) {
        return NextResponse.json(
          { error: 'Translation service quota exceeded' },
          { status: 429 }
        );
      }
    }

    return NextResponse.json({ error: 'Translation failed' }, { status: 500 });
  }
}

export const POST = handler;
