import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/utils';

import { shouldUseMockData, getMockTranscript } from '@/lib/mock-data';
import { mergeTranscriptSegmentsIntoSentences } from '@/lib/transcript-sentence-merger';
function respondWithError(
  payload: Record<string, unknown>,
  status: number
) {
  return NextResponse.json(payload, { status });
}

// Helper function to fetch transcript from Supadata
async function fetchTranscriptFromSupadata(
  videoId: string,
  apiKey: string,
  lang?: string
): Promise<{
  segments: any[] | null;
  language?: string;
  availableLanguages?: string[];
  status: number;
  error?: string;
}> {
  const apiUrl = new URL('https://api.supadata.ai/v1/transcript');
  apiUrl.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
  if (lang) {
    apiUrl.searchParams.set('lang', lang);
  }

  const response = await fetch(apiUrl.toString(), {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });

  const responseText = await response.text();
  let parsedBody: Record<string, unknown> | null = null;

  if (responseText) {
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      parsedBody = null;
    }
  }

  if (!response.ok || response.status === 206) {
    return {
      segments: null,
      status: response.status,
      error: typeof parsedBody?.error === 'string' ? parsedBody.error : 'Failed to fetch transcript'
    };
  }

  const candidateContent = Array.isArray(parsedBody?.content)
    ? parsedBody?.content
    : Array.isArray(parsedBody?.transcript)
      ? parsedBody?.transcript
      : Array.isArray(parsedBody)
        ? parsedBody
        : null;

  return {
    segments: candidateContent,
    language: typeof parsedBody?.lang === 'string' ? parsedBody.lang : undefined,
    availableLanguages: Array.isArray(parsedBody?.availableLangs)
      ? parsedBody.availableLangs.filter((l): l is string => typeof l === 'string')
      : undefined,
    status: response.status
  };
}

// Helper function to transform raw segments
// Supadata can return timestamps in either milliseconds (offset > 1000) or seconds (offset < 100)
// We need to detect the format and normalize to seconds
function transformSegments(transcriptSegments: any[]): { text: string; start: number; duration: number }[] {
  if (transcriptSegments.length === 0) return [];

  // Detect if timestamps are in milliseconds or seconds
  // Sample the first few segments to determine the format
  const sampleSize = Math.min(5, transcriptSegments.length);
  let totalOffset = 0;
  let offsetCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const item = transcriptSegments[i];
    if (item.offset !== undefined && item.offset > 0) {
      totalOffset += item.offset;
      offsetCount++;
    } else if (item.start !== undefined && item.start > 0) {
      totalOffset += item.start;
      offsetCount++;
    }
  }

  // If average offset/start is > 1000, values are likely in milliseconds
  // If average is < 1000, values are likely in seconds
  // For a 5-segment sample at the start of a video, if values are in milliseconds,
  // we'd expect offsets in the thousands (e.g., 5000ms = 5s)
  // If values are in seconds, we'd expect offsets < 100 (e.g., 5s, 10s)
  const avgOffset = offsetCount > 0 ? totalOffset / offsetCount : 0;
  const isMilliseconds = avgOffset > 500; // If avg > 500, likely milliseconds

  console.log('[TRANSCRIPT] Timestamp format detection:', {
    avgOffset,
    isMilliseconds,
    sampleValues: transcriptSegments.slice(0, 3).map(s => ({ offset: s.offset, start: s.start, duration: s.duration }))
  });

  return transcriptSegments.map((item) => {
    const rawOffset = item.offset !== undefined ? item.offset : item.start;
    const rawDuration = item.duration !== undefined ? item.duration : 0;

    return {
      text: item.text || item.content || '',
      // Convert to seconds if values are in milliseconds
      start: isMilliseconds ? (rawOffset || 0) / 1000 : (rawOffset || 0),
      duration: isMilliseconds ? (rawDuration || 0) / 1000 : (rawDuration || 0)
    };
  });
}

// Calculate transcript duration from segments
function calculateTranscriptDuration(segments: { start: number; duration: number }[]): number {
  if (segments.length === 0) return 0;
  const lastSegment = segments[segments.length - 1];
  return lastSegment.start + lastSegment.duration;
}

async function handler(request: NextRequest) {
  try {
    const { url, lang, expectedDuration } = await request.json();

    if (!url) {
      return respondWithError({ error: 'YouTube URL is required' }, 400);
    }

    const videoId = extractVideoId(url);

    if (!videoId) {
      return respondWithError({ error: 'Invalid YouTube URL' }, 400);
    }

    if (shouldUseMockData()) {
      console.log(
        '[TRANSCRIPT] Using mock data (NEXT_PUBLIC_USE_MOCK_DATA=true)'
      );
      const mockData = getMockTranscript();

      const rawSegments = mockData.content.map((item: any) => ({
        text: item.text,
        start: item.offset / 1000, // Convert milliseconds to seconds
        duration: item.duration / 1000 // Convert milliseconds to seconds
      }));

      // Merge segments into complete sentences for better translation
      const mergedSentences = mergeTranscriptSegmentsIntoSentences(rawSegments);
      const transformedTranscript = mergedSentences.map((sentence) => ({
        text: sentence.text,
        start: sentence.segments[0].start, // Use first segment's start time
        duration: sentence.segments.reduce((sum, seg) => sum + seg.duration, 0) // Sum all durations
      }));

      return NextResponse.json({
        videoId,
        transcript: transformedTranscript,
        language: mockData.lang || 'en',
        availableLanguages: mockData.availableLangs || ['en']
      });
    }

    const apiKey = process.env.SUPADATA_API_KEY;
    if (!apiKey) {
      return respondWithError({ error: 'API configuration error' }, 500);
    }

    // Fetch transcript with retry logic for incomplete results
    let bestResult: {
      segments: any[];
      language?: string;
      availableLanguages?: string[];
      langUsed?: string;
    } | null = null;

    // Languages to try: first auto-detect, then explicit 'en', then other available languages
    const languagesToTry: (string | undefined)[] = [lang]; // Start with user-specified or auto-detect

    for (const langToTry of languagesToTry) {
      console.log(`[TRANSCRIPT] Attempting fetch for ${videoId} with lang=${langToTry ?? 'auto-detect'}`);

      const result = await fetchTranscriptFromSupadata(videoId, apiKey, langToTry);

      if (result.segments && result.segments.length > 0) {
        // Log raw segment data from Supadata for debugging
        console.log('[TRANSCRIPT] Raw Supadata segments (first 3):', {
          videoId,
          langUsed: langToTry ?? 'auto-detect',
          sampleSegments: result.segments.slice(0, 3).map(s => ({
            text: s.text?.substring(0, 50) || s.content?.substring(0, 50),
            offset: s.offset,
            start: s.start,
            duration: s.duration
          }))
        });

        const rawSegments = transformSegments(result.segments);
        const duration = calculateTranscriptDuration(rawSegments);

        console.log('[TRANSCRIPT] Supadata response:', {
          videoId,
          status: result.status,
          segmentCount: result.segments.length,
          transcriptDuration: Math.round(duration),
          language: result.language,
          langUsed: langToTry ?? 'auto-detect',
          availableLanguages: result.availableLanguages
        });

        // Check if this is a better result than what we have
        if (!bestResult) {
          bestResult = {
            segments: result.segments,
            language: result.language,
            availableLanguages: result.availableLanguages,
            langUsed: langToTry
          };

          // If transcript seems complete (covers expected duration reasonably), use it
          // Otherwise, try other languages
          if (expectedDuration && duration >= expectedDuration * 0.5) {
            console.log(`[TRANSCRIPT] Transcript covers ${Math.round(duration / expectedDuration * 100)}% of expected duration, accepting`);
            break;
          } else if (!expectedDuration) {
            // No expected duration provided, use first successful result
            // But if available languages exist and transcript is suspiciously short, try alternatives
            if (result.availableLanguages && result.availableLanguages.length > 1 && duration < 300) {
              // Less than 5 minutes, might be incomplete - add other languages to try
              for (const altLang of result.availableLanguages) {
                if (altLang !== langToTry && !languagesToTry.includes(altLang)) {
                  languagesToTry.push(altLang);
                }
              }
              // Also try explicit 'en' if not already tried
              if (langToTry !== 'en' && !languagesToTry.includes('en')) {
                languagesToTry.push('en');
              }
            } else {
              break;
            }
          } else {
            // Transcript too short, try other languages
            console.log(`[TRANSCRIPT] Transcript only covers ${Math.round(duration / expectedDuration * 100)}% of expected duration, trying other languages`);
            // Add available languages to try
            if (result.availableLanguages) {
              for (const altLang of result.availableLanguages) {
                if (altLang !== langToTry && !languagesToTry.includes(altLang)) {
                  languagesToTry.push(altLang);
                }
              }
            }
            // Also try explicit 'en' if not already tried
            if (langToTry !== 'en' && !languagesToTry.includes('en')) {
              languagesToTry.push('en');
            }
          }
        } else {
          // Compare with existing best result
          const bestRawSegments = transformSegments(bestResult.segments);
          const bestDuration = calculateTranscriptDuration(bestRawSegments);

          if (duration > bestDuration) {
            console.log(`[TRANSCRIPT] Found better result: ${Math.round(duration)}s vs ${Math.round(bestDuration)}s`);
            bestResult = {
              segments: result.segments,
              language: result.language,
              availableLanguages: result.availableLanguages,
              langUsed: langToTry
            };
          }
        }
      } else if (result.status === 404) {
        console.log(`[TRANSCRIPT] No transcript available with lang=${langToTry ?? 'auto-detect'}`);
      } else {
        console.log(`[TRANSCRIPT] Failed to fetch with lang=${langToTry ?? 'auto-detect'}: ${result.error}`);
      }
    }

    if (!bestResult || bestResult.segments.length === 0) {
      return respondWithError(
        { error: 'No transcript available for this video. The video may not have subtitles enabled.' },
        404
      );
    }

    const rawSegments = transformSegments(bestResult.segments);
    const language = bestResult.language;
    const availableLanguages = bestResult.availableLanguages;

    // Merge segments into complete sentences for better translation
    const mergedSentences = mergeTranscriptSegmentsIntoSentences(rawSegments);
    const transformedTranscript = mergedSentences.map((sentence) => ({
      text: sentence.text,
      start: sentence.segments[0].start, // Use first segment's start time
      duration: sentence.segments.reduce((sum, seg) => sum + seg.duration, 0) // Sum all durations
    }));

    // Calculate transcript duration (time covered by the transcript)
    const transcriptDuration = rawSegments.length > 0
      ? rawSegments[rawSegments.length - 1].start + rawSegments[rawSegments.length - 1].duration
      : 0;

    // Determine if transcript might be partial
    const coverageRatio = expectedDuration ? transcriptDuration / expectedDuration : null;
    const isPartial = expectedDuration
      ? transcriptDuration < expectedDuration * 0.5 // Less than 50% coverage
      : false;

    // Diagnostic logging: track processed transcript stats
    console.log('[TRANSCRIPT] Processed transcript:', {
      videoId,
      rawSegmentCount: rawSegments.length,
      mergedSegmentCount: transformedTranscript.length,
      transcriptDuration: Math.round(transcriptDuration),
      expectedDuration: expectedDuration ?? 'not provided',
      coverageRatio: coverageRatio ? `${Math.round(coverageRatio * 100)}%` : 'unknown',
      isPartial,
      firstSegmentStart: rawSegments[0]?.start,
      lastSegmentEnd: rawSegments.length > 0
        ? rawSegments[rawSegments.length - 1].start + rawSegments[rawSegments.length - 1].duration
        : 0
    });

    return NextResponse.json({
      videoId,
      transcript: transformedTranscript,
      language,
      availableLanguages,
      // Transcript metadata for debugging and completeness validation
      transcriptDuration: Math.round(transcriptDuration),
      segmentCount: transformedTranscript.length,
      rawSegmentCount: rawSegments.length,
      isPartial,
      coverageRatio: coverageRatio ? Math.round(coverageRatio * 100) : undefined
    });
  } catch (error) {
    console.error('[TRANSCRIPT] Error processing transcript:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: error?.constructor?.name
    });
    return respondWithError({ error: 'Failed to fetch transcript' }, 500);
  }
}

export const POST = handler;
