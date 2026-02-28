import { NextResponse } from "next/server";
import { getRandomVideo } from "@/lib/db-queries";

async function handler() {
  try {
    const randomVideo = getRandomVideo();

    if (!randomVideo) {
      return NextResponse.json(
        { error: "No analyzed videos are available yet." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      youtubeId: randomVideo.youtube_id,
      title: randomVideo.title,
      author: randomVideo.author,
      duration: randomVideo.duration,
      thumbnail: randomVideo.thumbnail_url,
      slug: randomVideo.slug,
      url: `https://www.youtube.com/watch?v=${randomVideo.youtube_id}`,
    });
  } catch (error) {
    console.error("Unexpected error while resolving feeling lucky request:", error);
    return NextResponse.json(
      { error: "Unable to load a sample video right now." },
      { status: 500 }
    );
  }
}

export const GET = handler;
