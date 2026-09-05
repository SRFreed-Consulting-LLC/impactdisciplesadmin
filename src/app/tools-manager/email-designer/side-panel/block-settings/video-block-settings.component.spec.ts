import { VideoBlock } from 'src/app/common/models/admin/email-design.model';
import { VideoBlockSettingsComponent } from './video-block-settings.component';

// The custom-thumbnail test moved here from
// designer-side-panel.component.spec.ts on 2026-09-05 with the code it
// covers (review item 3, block editors); the URL-driven behaviour is new
// coverage. The http stub records the oEmbed calls and answers each one.

function makeComponent(props: Partial<VideoBlock['props']> = {}) {
  const commits: number[] = [];
  const state = { commit: (mutate: () => void) => { commits.push(1); mutate(); } };
  const oembedCalls: string[] = [];
  let oembedAnswer: { thumbnail_url?: string } | Error = { thumbnail_url: 'https://vimeo.test/thumb.jpg' };
  const http = {
    get: (url: string) => {
      oembedCalls.push(url);
      return {
        subscribe: (observer: { next: (r: unknown) => void; error: () => void }) => {
          if (oembedAnswer instanceof Error) {
            observer.error();
          } else {
            observer.next(oembedAnswer);
          }
        }
      };
    }
  };
  const component = new VideoBlockSettingsComponent(state as never, http as never);
  component.block = {
    type: 'video',
    props: { url: '', provider: 'other', videoId: null, thumbnailUrl: null, customThumbnail: false, caption: '', ...props }
  } as unknown as VideoBlock;
  return {
    component, commits, oembedCalls,
    failOembed: () => { oembedAnswer = new Error('private'); }
  };
}

describe('VideoBlockSettingsComponent', () => {
  it('a YouTube URL sets provider, id and an automatic thumbnail in one commit', () => {
    const { component, commits, oembedCalls } = makeComponent();
    component.onUrlChange('https://www.youtube.com/watch?v=abc123xyz00');
    expect(component.block.props.provider).toBe('youtube');
    expect(component.block.props.videoId).toBe('abc123xyz00');
    expect(component.block.props.thumbnailUrl).toContain('abc123xyz00');
    expect(commits.length).toBe(1);
    expect(oembedCalls).toEqual([]);
  });

  it('a Vimeo URL fetches its thumbnail through oEmbed, as a second commit', () => {
    const { component, commits, oembedCalls } = makeComponent();
    component.onUrlChange('https://vimeo.com/123456');
    expect(component.block.props.provider).toBe('vimeo');
    expect(oembedCalls.length).toBe(1);
    expect(component.block.props.thumbnailUrl).toBe('https://vimeo.test/thumb.jpg');
    expect(commits.length).toBe(2);
  });

  it('leaves the thumbnail empty when oEmbed fails', () => {
    const { component, failOembed } = makeComponent();
    failOembed();
    component.onUrlChange('https://vimeo.com/123456');
    expect(component.block.props.thumbnailUrl).toBeNull();
  });

  it('never overwrites a CUSTOM thumbnail from the URL', () => {
    const { component, oembedCalls } = makeComponent({ customThumbnail: true, thumbnailUrl: 'https://x.test/mine.png' });
    component.onUrlChange('https://vimeo.com/123456');
    expect(component.block.props.thumbnailUrl).toBe('https://x.test/mine.png');
    expect(oembedCalls).toEqual([]);
  });

  it('writes a picked image as the thumbnail and flags it custom', () => {
    const { component, commits } = makeComponent();
    component.openThumbnailPicker();
    component.pickerCard = { image: { url: 'https://x.test/thumb.png', name: 't.png' } as never };
    component.onPickerClosed();
    expect(component.block.props.thumbnailUrl).toBe('https://x.test/thumb.png');
    expect(component.block.props.customThumbnail).toBeTrue();
    expect(commits.length).toBe(1);
    expect(component.pickerVisible$.value).toBeFalse();
  });

  it('does nothing when the picker closes with no image', () => {
    const { component, commits } = makeComponent({ thumbnailUrl: 'https://x.test/keep.png' });
    component.openThumbnailPicker();
    component.pickerCard = {};
    component.onPickerClosed();
    expect(component.block.props.thumbnailUrl).toBe('https://x.test/keep.png');
    expect(commits.length).toBe(0);
  });

  it('"use source thumbnail" drops the custom one and re-derives from the URL', () => {
    const { component } = makeComponent({
      url: 'https://www.youtube.com/watch?v=abc123xyz00', provider: 'youtube', customThumbnail: true, thumbnailUrl: 'https://x.test/mine.png'
    });
    component.useSourceThumbnail();
    expect(component.block.props.customThumbnail).toBeFalse();
    expect(component.block.props.thumbnailUrl).toContain('abc123xyz00');
  });
});
