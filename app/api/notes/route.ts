import { NextRequest, NextResponse } from 'next/server';
import { formatValidationError, noteDeleteSchema, noteInsertSchema } from '@/lib/validation';
import { z } from 'zod';
import {
  getNotesByVideoId,
  getNotesByYoutubeId,
  createNote,
  deleteNote,
  getVideoByYoutubeId
} from '@/lib/db-queries';

const getNotesQuerySchema = z.object({
  youtubeId: z.string().optional(),
  videoId: z.string().optional()
}).refine(data => data.youtubeId || data.videoId, {
  message: 'Either youtubeId or videoId must be provided'
});

async function handler(req: NextRequest) {
  if (req.method === 'GET') {
    const { searchParams } = new URL(req.url);
    const youtubeId = searchParams.get('youtubeId');
    const videoIdParam = searchParams.get('videoId');

    try {
      const validated = getNotesQuerySchema.parse({ youtubeId: youtubeId ?? undefined, videoId: videoIdParam ?? undefined });

      let notes: ReturnType<typeof getNotesByVideoId> = [];
      if (validated.videoId) {
        notes = getNotesByVideoId(validated.videoId);
      } else if (validated.youtubeId) {
        notes = getNotesByYoutubeId(validated.youtubeId);
      } else {
        notes = [];
      }

      return NextResponse.json({ notes });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: formatValidationError(error) },
          { status: 400 }
        );
      }
      console.error('Error fetching notes:', error);
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const validatedData = noteInsertSchema.parse(body);

      let targetVideoId = validatedData.videoId;
      if (!targetVideoId && validatedData.youtubeId) {
        const video = getVideoByYoutubeId(validatedData.youtubeId);
        targetVideoId = video?.id;
      }

      if (!targetVideoId) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }

      const note = createNote({
        videoId: targetVideoId,
        source: validatedData.source,
        sourceId: validatedData.sourceId || null,
        text: validatedData.text,
        metadata: validatedData.metadata || {}
      });

      if (!note) {
        return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
      }

      return NextResponse.json({ note }, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: formatValidationError(error) },
          { status: 400 }
        );
      }
      console.error('Error creating note:', error);
      return NextResponse.json({ error: 'Failed to save note' }, { status: 500 });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const body = await req.json();
      const { noteId } = noteDeleteSchema.parse(body);

      const success = deleteNote(noteId);
      if (!success) {
        return NextResponse.json({ error: 'Note not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: formatValidationError(error) },
          { status: 400 }
        );
      }
      console.error('Error deleting note:', error);
      return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
