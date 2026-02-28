import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/utils';
import { ensureMergedFormat } from '@/lib/transcript-format-detector';
import { TranscriptSegment } from '@/lib/types';
import { getVideoByYoutubeId, parseVideoRow } from '@/lib/db-queries';

async function handler(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    const row = getVideoByYoutubeId(videoId);

    if (row && row.topics) {
      const cachedVideo = parseVideoRow(row);

      const originalTranscript = (cachedVideo.transcript ?? []) as TranscriptSegment[];
      const migratedTranscript = ensureMergedFormat(originalTranscript, {
        enableLogging: true,
        context: `YouTube ID: ${videoId}`
      });

      return NextResponse.json({
        cached: true,
        videoId,
        videoDbId: cachedVideo.id,
        topics: cachedVideo.topics,
        transcript: migratedTranscript,
        videoInfo: {
          title: cachedVideo.title,
          author: cachedVideo.author,
          duration: cachedVideo.duration,
          thumbnail: cachedVideo.thumbnail_url,
          language: cachedVideo.language ?? undefined,
          availableLanguages: cachedVideo.available_languages ?? undefined
        },
        summary: cachedVideo.summary,
        suggestedQuestions: cachedVideo.suggested_questions,
        cacheDate: cachedVideo.created_at
      });
    }

    return NextResponse.json({
      cached: false,
      videoId
    });
  } catch (error) {
    console.error('Error checking video cache:', error);
    return NextResponse.json(
      { error: 'Failed to check video cache' },
      { status: 500 }
    );
  }
}

export const POST = handler;
