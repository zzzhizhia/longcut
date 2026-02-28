import { NextRequest, NextResponse } from 'next/server';
import { updateVideoAnalysis } from '@/lib/db-queries';

async function handler(req: NextRequest) {
  try {
    const { videoId, summary, suggestedQuestions } = await req.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const result = updateVideoAnalysis(videoId, {
      summary: summary ?? null,
      suggestedQuestions: suggestedQuestions ?? null
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      videoId: result.videoId
    });
  } catch (error) {
    console.error('Error in update video analysis:', error);
    return NextResponse.json(
      { error: 'Failed to process update request' },
      { status: 500 }
    );
  }
}

export const POST = handler;
