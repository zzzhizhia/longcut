import { NextRequest, NextResponse } from 'next/server';
import {
  videoAnalysisRequestSchema,
  formatValidationError
} from '@/lib/validation';
import { z } from 'zod';
import {
  generateTopicsFromTranscript,
  generateThemesFromTranscript
} from '@/lib/ai-processing';
import { ensureMergedFormat } from '@/lib/transcript-format-detector';
import { TranscriptSegment } from '@/lib/types';
import { getVideoByYoutubeId, upsertVideoAnalysis, parseVideoRow } from '@/lib/db-queries';

async function handler(req: NextRequest) {
  try {
    const body = await req.json();

    let validatedData;
    try {
      validatedData = videoAnalysisRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: formatValidationError(error) },
          { status: 400 }
        );
      }
      throw error;
    }

    const {
      videoId,
      videoInfo,
      transcript,
      forceRegenerate,
      theme,
      mode
    } = validatedData;

    // Check cache
    let cachedVideo: ReturnType<typeof parseVideoRow> | null = null;
    if (!forceRegenerate) {
      const row = getVideoByYoutubeId(videoId);
      cachedVideo = row ? parseVideoRow(row) : null;
    }

    // Handle theme-specific generation
    if (theme) {
      try {
        const { topics: themedTopics } = await generateTopicsFromTranscript(
          transcript,
          {
            videoInfo,
            theme,
            excludeTopicKeys: new Set(validatedData.excludeTopicKeys ?? []),
            includeCandidatePool: false,
            mode,
            language: videoInfo?.language
          }
        );

        if (themedTopics.length === 0) {
          return NextResponse.json({
            topics: [],
            theme,
            cached: false,
            topicCandidates: undefined,
            error: `No content found for theme: "${theme}"`
          });
        }

        return NextResponse.json({
          topics: themedTopics,
          theme,
          cached: false,
          topicCandidates: undefined
        });
      } catch (error) {
        console.error('Error generating theme-specific topics:', error);
        return NextResponse.json(
          { error: 'Failed to generate themed topics. Please try again.' },
          { status: 500 }
        );
      }
    }

    // Serve cached analysis
    if (!forceRegenerate && cachedVideo && cachedVideo.topics) {
      let themes: string[] = [];
      try {
        themes = await generateThemesFromTranscript(
          transcript,
          videoInfo,
          undefined,
          videoInfo?.language
        );
      } catch (error) {
        console.error('Error generating themes for cached video:', error);
      }

      const originalTranscript = (cachedVideo.transcript ?? []) as TranscriptSegment[];
      const migratedTranscript = ensureMergedFormat(originalTranscript, {
        enableLogging: true,
        context: `YouTube ID: ${videoId}`
      });

      return NextResponse.json({
        topics: cachedVideo.topics,
        transcript: migratedTranscript,
        videoInfo: {
          title: cachedVideo.title,
          author: cachedVideo.author,
          duration: cachedVideo.duration,
          thumbnail: cachedVideo.thumbnail_url
        },
        summary: cachedVideo.summary,
        suggestedQuestions: cachedVideo.suggested_questions,
        themes,
        cached: true,
        cacheDate: cachedVideo.created_at,
        videoDbId: cachedVideo.id
      });
    }

    // Generate new analysis
    const generationResult = await generateTopicsFromTranscript(
      transcript,
      {
        videoInfo,
        includeCandidatePool: validatedData.includeCandidatePool,
        excludeTopicKeys: new Set(validatedData.excludeTopicKeys ?? []),
        mode,
        language: videoInfo?.language
      }
    );
    const topics = generationResult.topics;
    const topicCandidates = generationResult.candidates;
    const modelUsed = generationResult.modelUsed;

    let themes: string[] = [];
    try {
      themes = await generateThemesFromTranscript(
        transcript,
        videoInfo,
        undefined,
        videoInfo?.language
      );
    } catch (error) {
      console.error('Error generating themes:', error);
    }

    // Save to SQLite
    let videoDbId: string | undefined;
    try {
      const result = upsertVideoAnalysis({
        youtubeId: videoId,
        title: videoInfo?.title || `YouTube Video ${videoId}`,
        author: videoInfo?.author || null,
        duration: videoInfo?.duration ?? 0,
        thumbnailUrl: videoInfo?.thumbnail || null,
        transcript,
        topics,
        summary: null,
        suggestedQuestions: null,
        modelUsed,
        language: videoInfo?.language || null,
        availableLanguages: videoInfo?.availableLanguages || null
      });
      videoDbId = result.id;
    } catch (error) {
      console.error(`[video-analysis] Failed to save video ${videoId}:`, error);
    }

    return NextResponse.json({
      topics,
      themes,
      cached: false,
      topicCandidates: validatedData.includeCandidatePool
        ? topicCandidates ?? []
        : undefined,
      modelUsed,
      videoDbId
    });
  } catch (error) {
    console.error('Error in video analysis:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}

export const POST = handler;
