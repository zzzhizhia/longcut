import { NextRequest, NextResponse } from 'next/server';
import { getAllNotesWithVideo } from '@/lib/db-queries';

async function handler(req: NextRequest) {
  if (req.method === 'GET') {
    try {
      const notes = getAllNotesWithVideo();
      return NextResponse.json({ notes });
    } catch (error) {
      console.error('Error fetching all notes:', error);
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export const GET = handler;
