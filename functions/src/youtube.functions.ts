import {onRequest} from "firebase-functions/v2/https";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

/**
 * Shared implementation for both exports below: fetches the podcast
 * YouTube playlist server-side and returns only the resulting video items.
 * The YouTube Data API key (GOOGLE_SECRET_KEY) and playlist id
 * (YOUTUBE_PLAYLIST_KEY) never leave the server -- this replaces the old
 * get_youtube_keys, which handed the raw API key back to the browser
 * (where it landed in client JS and request URLs).
 * @param {any} response The Express-style response to write to.
 * @return {Promise<void>} Resolves once a response has been sent.
 */
async function fetchAndSendPlaylistVideos(response): Promise<void> {
  const apiKey = process.env.GOOGLE_SECRET_KEY;
  const playlistId = process.env.YOUTUBE_PLAYLIST_KEY;
  const base = "https://www.googleapis.com/youtube/v3/playlistItems";

  try {
    const videos: unknown[] = [];
    let pageToken: string | undefined;

    do {
      let url = `${base}?key=${apiKey}` +
        "&part=snippet,contentDetails&maxResults=50" +
        `&playlistId=${playlistId}`;
      if (pageToken) {
        url += "&pageToken=" + pageToken;
      }

      const ytResponse = await fetch(url);
      if (!ytResponse.ok) {
        response.status(502).send({
          code: 502,
          error: "Failed to fetch playlist from YouTube",
        });
        return;
      }

      const result = await ytResponse.json() as {
        items?: unknown[];
        nextPageToken?: string;
      };

      if (Array.isArray(result.items)) {
        videos.push(...result.items);
      }
      pageToken = result.nextPageToken;
    } while (pageToken);

    response.send({videos});
  } catch (err) {
    console.log(String(err));
    response.status(500).send({code: 500, error: "Internal error"});
  }
}

// Staff-gated: only a signed-in admin's own Firebase Auth session may call
// this. This is what the admin app's own podcast-management page uses.
exports.get_youtube_videos = onRequest(
  {secrets: ["GOOGLE_SECRET_KEY", "YOUTUBE_PLAYLIST_KEY"]},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        await requireStaffAuth(request);
      } catch {
        response.status(401).send({code: 401, error: "Unauthorized"});
        return;
      }

      await fetchAndSendPlaylistVideos(response);
    });
  });

// Public counterpart for impactdisciples-web's own public /podcasts page,
// which has no Firebase Auth session to gate on. Was previously calling a
// long-retired function (get_youtube_keys) that no longer exists -- the
// podcast page has been silently broken client-side ever since that
// function was replaced by the staff-gated one above, since a fully public
// page can never satisfy requireStaffAuth. Deliberately a *separate*
// export, not a loosening of get_youtube_videos's own auth requirement --
// the admin app's internal use of that one is untouched. The playlist
// video list itself is not sensitive (it's the same content already
// public on YouTube); only the API key needed protecting, and this keeps
// it server-side exactly the same way the staff-gated version does.
exports.get_youtube_videos_public = onRequest(
  {secrets: ["GOOGLE_SECRET_KEY", "YOUTUBE_PLAYLIST_KEY"]},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      await fetchAndSendPlaylistVideos(response);
    });
  });

// ---------------------------------------------------------------------
// v2 feed: normalized, tag-enriched, and cached.
//
// The two functions above hand back raw playlistItems. Those carry no
// tags -- YouTube exposes snippet.tags only on the *videos* resource --
// and they push the YouTube payload shape out to every client. This one
// makes the second call (videos.list, 50 ids per batch), joins the two,
// and returns a flat shape the web app renders directly.
//
// The module-scope cache is what makes "fetch on every page render"
// affordable: a warm instance answers repeat visitors without touching
// YouTube at all. A cold fetch of a ~100-video playlist costs 1
// playlistItems unit + 2 videos units against a 10,000/day quota.
// ---------------------------------------------------------------------

interface YoutubePodcast {
  id: string;
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  tags: string[];
}

const PODCAST_CACHE_TTL_MS = 30 * 60 * 1000;
let podcastCache: {items: YoutubePodcast[]; fetchedAt: number} | null = null;

const YT_API = "https://www.googleapis.com/youtube/v3";

/**
 * Pages the configured playlist and collects just the video ids. Only
 * contentDetails is requested -- the snippet on a playlistItem is a copy
 * of the video's snippet taken when it was added to the playlist, so it
 * can be stale; fetchVideoDetails() below reads the live one.
 * @param {string} apiKey YouTube Data API key.
 * @param {string} playlistId The podcast playlist id.
 * @return {Promise<string[]>} Video ids in playlist order.
 */
async function fetchPlaylistVideoIds(
  apiKey: string,
  playlistId: string
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    let url = `${YT_API}/playlistItems?key=${apiKey}` +
      "&part=contentDetails&maxResults=50" +
      `&playlistId=${playlistId}`;
    if (pageToken) {
      url += "&pageToken=" + pageToken;
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("playlistItems failed: " + res.status);
    }

    const json = await res.json() as {
      items?: {contentDetails?: {videoId?: string}}[];
      nextPageToken?: string;
    };

    for (const item of json.items ?? []) {
      const videoId = item.contentDetails?.videoId;
      if (videoId) {
        ids.push(videoId);
      }
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  return ids;
}

/**
 * Looks up the live snippet for each id, 50 at a time (the endpoint's
 * per-request maximum). This is the call that yields tags. Ids that no
 * longer resolve -- deleted or made private since the playlist was built
 * -- simply come back missing, which drops them from the feed.
 * @param {string} apiKey YouTube Data API key.
 * @param {string[]} ids Video ids to look up.
 * @return {Promise<YoutubePodcast[]>} One entry per resolvable id.
 */
async function fetchVideoDetails(
  apiKey: string,
  ids: string[]
): Promise<YoutubePodcast[]> {
  const podcasts: YoutubePodcast[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `${YT_API}/videos?key=${apiKey}` +
      "&part=snippet&maxResults=50" +
      `&id=${batch.join(",")}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("videos failed: " + res.status);
    }

    const json = await res.json() as {
      items?: {
        id?: string;
        snippet?: {
          title?: string;
          description?: string;
          publishedAt?: string;
          tags?: string[];
          thumbnails?: Record<string, {url?: string}>;
        };
      }[];
    };

    for (const item of json.items ?? []) {
      const snippet = item.snippet;
      if (!item.id || !snippet) {
        continue;
      }

      const thumbs = snippet.thumbnails ?? {};
      const thumbnailUrl = thumbs.maxres?.url ?? thumbs.standard?.url ??
        thumbs.high?.url ?? "";

      podcasts.push({
        id: item.id,
        videoId: item.id,
        title: snippet.title ?? "",
        description: snippet.description ?? "",
        publishedAt: snippet.publishedAt ?? "",
        thumbnailUrl,
        tags: snippet.tags ?? [],
      });
    }
  }

  return podcasts;
}

/**
 * Builds the whole feed: playlist ids, then live details, newest first.
 * @return {Promise<YoutubePodcast[]>} The episodes, newest first.
 */
async function buildPodcastFeed(): Promise<YoutubePodcast[]> {
  const apiKey = process.env.GOOGLE_SECRET_KEY ?? "";
  const playlistId = process.env.YOUTUBE_PLAYLIST_KEY ?? "";

  const ids = await fetchPlaylistVideoIds(apiKey, playlistId);
  if (ids.length === 0) {
    return [];
  }

  const podcasts = await fetchVideoDetails(apiKey, ids);

  return podcasts.sort((a, b) =>
    Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/**
 * Writes the feed with a browser cache header. These are raw
 * cloudfunctions.net URLs with no CDN in front, so max-age buys a
 * returning visitor's own browser cache -- the module cache above is what
 * spares YouTube.
 * @param {any} response The Express-style response.
 * @param {YoutubePodcast[]} videos The episodes to send.
 * @return {void}
 */
function sendPodcasts(response, videos: YoutubePodcast[]): void {
  response.set("Cache-Control", "public, max-age=900");
  response.send({videos});
}

// Public: the web site's podcast page calls this on load. Same reasoning
// as get_youtube_videos_public above -- the video list is already public
// on YouTube, only the API key needed protecting, and it stays server
// side.
exports.get_youtube_podcasts_public = onRequest(
  {secrets: ["GOOGLE_SECRET_KEY", "YOUTUBE_PLAYLIST_KEY"]},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      const now = Date.now();
      const cached = podcastCache;

      if (cached && now - cached.fetchedAt < PODCAST_CACHE_TTL_MS) {
        sendPodcasts(response, cached.items);
        return;
      }

      try {
        const items = await buildPodcastFeed();
        podcastCache = {items, fetchedAt: now};
        sendPodcasts(response, items);
      } catch (err) {
        console.log(String(err));

        // Stale beats empty: if YouTube is down or the quota is spent, a
        // visitor still sees the episodes from the last good fetch rather
        // than a podcast page with nothing on it.
        if (cached) {
          sendPodcasts(response, cached.items);
          return;
        }

        response.status(502).send({
          code: 502,
          error: "Failed to fetch podcasts from YouTube",
        });
      }
    });
  });
