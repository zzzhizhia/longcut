import { MetadataRoute } from 'next';
import { buildVideoSlug } from '@/lib/utils';
import { getVideosForSitemap } from '@/lib/db-queries';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const videos = getVideosForSitemap();

  const normalizeSlug = (video: { slug: string | null; youtube_id: string | null; title: string | null }) => {
    const youtubeId = video.youtube_id ?? '';
    const hasCanonicalSuffix = Boolean(video.slug && youtubeId && video.slug.endsWith(youtubeId));
    const canonicalSlug = youtubeId ? buildVideoSlug(video.title, youtubeId) : null;

    if (hasCanonicalSuffix) {
      return video.slug;
    }

    return canonicalSlug || video.slug || null;
  };

  const videoUrls: MetadataRoute.Sitemap = videos
    .map(video => {
      const slug = normalizeSlug(video);

      if (!slug) {
        return null;
      }

      return {
        url: `https://longcut.ai/v/${slug}`,
        lastModified: new Date(video.updated_at),
        changeFrequency: 'monthly' as const,
        priority: 0.8
      };
    })
    .filter(Boolean) as MetadataRoute.Sitemap;

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: 'https://longcut.ai',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0
    },
  ];

  return [...staticPages, ...videoUrls];
}

export const revalidate = 3600;
