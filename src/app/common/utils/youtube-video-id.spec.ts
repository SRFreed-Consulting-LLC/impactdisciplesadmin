import { extractYouTubeVideoId, isUsableYouTubeVideo } from './youtube-video-id';

// Pure functions, no DI - hand-called, matching the house convention for
// this kind of util (see strip-undefined.spec.ts).
describe('extractYouTubeVideoId', () => {
  const ID = 'dQw4w9WgXcQ';

  it('THE REGRESSION: a share link\'s si= parameter is not an id', () => {
    // What was actually stored on the Summit 2027 event, which rendered an
    // empty box on the public page. 16 characters of the same alphabet as
    // a real id, which is why it looked right.
    expect(extractYouTubeVideoId('YN9xKK-kWJ3op23B')).toBeNull();
    expect(isUsableYouTubeVideo('YN9xKK-kWJ3op23B')).toBe(false);
    // ...and the link it came off still yields the id.
    expect(extractYouTubeVideoId(`https://youtu.be/${ID}?si=YN9xKK-kWJ3op23B`)).toBe(ID);
  });

  it('passes a bare id straight through', () => {
    expect(extractYouTubeVideoId(ID)).toBe(ID);
    expect(extractYouTubeVideoId(`  ${ID}  `)).toBe(ID);
  });

  it('takes the id out of every URL form YouTube hands out', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}&list=RDAMVM`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      // Pasted without a scheme, which is how people copy them.
      `youtu.be/${ID}`,
      `www.youtube.com/watch?v=${ID}`,
    ]) {
      expect(extractYouTubeVideoId(url)).withContext(url).toBe(ID);
    }
  });

  it('refuses what is neither an id nor a YouTube video', () => {
    for (const junk of [
      '',
      '   ',
      null,
      undefined,
      'not an id',
      'https://vimeo.com/123456789',
      'https://example.com/watch?v=' + ID,
      // A playlist with no video in it.
      'https://www.youtube.com/playlist?list=PLabc123',
      // Right shape, wrong length - 10 and 12.
      'dQw4w9WgXc',
      'dQw4w9WgXcQQ',
      // A channel, not a video.
      'https://www.youtube.com/@impactdisciples',
    ]) {
      expect(extractYouTubeVideoId(junk)).withContext(String(junk)).toBeNull();
    }
  });

  it('treats empty as usable, because the field is optional', () => {
    // An event with no promo video is normal - the public page falls back
    // to its own. Only a NON-EMPTY unusable value is an error.
    expect(isUsableYouTubeVideo('')).toBe(true);
    expect(isUsableYouTubeVideo(null)).toBe(true);
    expect(isUsableYouTubeVideo(ID)).toBe(true);
    expect(isUsableYouTubeVideo(`https://youtu.be/${ID}`)).toBe(true);
  });
});
