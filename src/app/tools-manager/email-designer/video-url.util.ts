import { VideoProvider } from 'src/app/common/models/admin/email-design.model';

export interface ParsedVideoUrl {
  provider: VideoProvider;
  videoId: string | null;
  // Directly derivable thumbnail (YouTube). Vimeo needs an async oEmbed
  // lookup - the caller does that; 'other' needs a manual thumbnail.
  thumbnailUrl: string | null;
}

// Recognizes the URL shapes Mailchimp's video block does: youtube.com/watch,
// youtu.be short links, YouTube Shorts, and vimeo.com/<id>. Anything else is
// 'other' (still allowed - the author supplies a thumbnail manually).
export function parseVideoUrl(url: string): ParsedVideoUrl {
  const trimmed = (url ?? '').trim();
  if (!trimmed) {
    return { provider: 'other', videoId: null, thumbnailUrl: null };
  }

  const youtube =
    trimmed.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtube\.com\/shorts\/|youtu\.be\/)([A-Za-z0-9_-]{6,20})/) ??
    null;
  if (youtube) {
    const videoId = youtube[1];
    return {
      provider: 'youtube',
      videoId,
      // No API needed - YouTube serves thumbnails at a stable URL scheme.
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    };
  }

  const vimeo = trimmed.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  if (vimeo) {
    return { provider: 'vimeo', videoId: vimeo[1], thumbnailUrl: null };
  }

  return { provider: 'other', videoId: null, thumbnailUrl: null };
}

// Vimeo's CORS-open oEmbed endpoint, used to fetch the source thumbnail.
export function vimeoOembedUrl(videoUrl: string): string {
  return 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(videoUrl.trim());
}
