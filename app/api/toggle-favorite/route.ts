import { NextRequest, NextResponse } from 'next/server';
import { toggleFavoriteRequestSchema, formatValidationError } from '@/lib/validation';
import { z } from 'zod';
import { toggleFavorite } from '@/lib/db-queries';

async function handler(req: NextRequest) {
  try {
    const body = await req.json();

    let validatedData;
    try {
      validatedData = toggleFavoriteRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: formatValidationError(error) },
          { status: 400 }
        );
      }
      throw error;
    }

    const { videoId, isFavorite } = validatedData;
    const result = toggleFavorite(videoId, isFavorite);

    if (!result.success) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      isFavorite: result.isFavorite
    });
  } catch (error) {
    console.error('Error toggling favorite:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}

export const POST = handler;
