import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { PageLivePreviewComponent } from './page-live-preview.component';
import { environment } from 'src/environments/environment';

// TestBed as an INJECTOR: this component takes DomSanitizer, NgZone and
// DestroyRef through inject(), so `new`-ing it throws NG0203. Nothing here
// needs a rendered template.
describe('PageLivePreviewComponent', () => {
  let component: PageLivePreviewComponent;

  const post = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data }));

  // Any change set that is not JUST `liveSection` reloads the frame. The
  // distinction is load-bearing - see isOnly() in the component - so the
  // specs are explicit about which kind they are triggering.
  const reload = { revision: {} } as never;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PageLivePreviewComponent] });
    component = TestBed.inject(PageLivePreviewComponent);
    component.path = '/seminars';
  });

  it('frames the page it was given, on the site this admin is paired with', () => {
    component.ngOnChanges(reload);

    const url = TestBed.inject(DomSanitizer)
      .sanitize(SecurityContext.RESOURCE_URL, component.src!) ?? '';

    expect(url).toContain(environment.previewSiteUrl);
    expect(url).toContain('/seminars');
  });

  it('changes the address on every revision - the only way to reload a frame', () => {
    component.revision = 1;
    component.ngOnChanges(reload);
    const first = String(component.src);

    component.revision = 2;
    component.ngOnChanges(reload);

    expect(String(component.src)).not.toBe(first);
  });

  it('shrinks a desktop page to the rail, and never enlarges a phone', () => {
    // 390 in a 430 rail would otherwise be blown up to 110%, which is not
    // what a phone looks like.
    component.device = 'desktop';
    expect(component.scale).toBeCloseTo(430 / 1440, 3);

    component.device = 'mobile';
    expect(component.scale).toBe(1);
  });

  it('reserves the SCALED box, so the source line does not sit under it', () => {
    // A transform does not affect layout; the wrapper has to do it.
    component.device = 'desktop';
    post({ impactPageHeight: 3000 });

    expect(component.scaledHeight).toBe(Math.round(3000 * (430 / 1440)));
    expect(component.scaledWidth).toBe(430);
  });

  it('takes a height the framed page reports', () => {
    post({ impactPageHeight: 4210 });

    expect(component.frameHeight).toBe(4210);
  });

  it('ignores a message that is not a plausible page height', () => {
    // Checked by SHAPE, not origin - the origin varies across four admin
    // environments. The worst a bad sender achieves is a mis-sized preview in
    // their own browser, but it should not even manage that.
    post({ impactPageHeight: 4210 });

    post({ impactPageHeight: '9999' });
    post({ impactPageHeight: -5 });
    post({ impactPageHeight: 0 });
    post({ impactPageHeight: 999999 });
    post({ impactPageHeight: Number.NaN });
    post({ somethingElse: 1234 });
    post('a string');
    post(null);

    expect(component.frameHeight).toBe(4210);
  });

  it('narrows to one section when the editor is open', () => {
    component.sectionKey = 'overview';
    component.ngOnChanges(reload);

    expect(String(component.src)).toContain('section=overview');
  });

  it('leaves the whole page alone when no section is being edited', () => {
    component.ngOnChanges(reload);

    expect(String(component.src)).not.toContain('section=');
  });

  it('does NOT reload the frame for a keystroke', () => {
    // A new `liveSection` is posted into the running page. Reloading on it
    // would blank the preview between every two letters.
    component.ngOnChanges(reload);
    const before = String(component.src);

    component.liveSection = { key: 'overview', heading: 'typing' };
    component.ngOnChanges({ liveSection: {} } as never);

    expect(String(component.src)).toBe(before);
  });

  it('names the address it is showing, without the cache-buster', () => {
    // So nobody debugs a stale deployed build thinking it is their own work.
    expect(component.shownUrl).toBe(`${environment.previewSiteUrl}/seminars`);
    expect(component.shownUrl).not.toContain('adminPreview');
  });

  it('frames the site root for the home page, with no trailing slash', () => {
    // The Home screen passes '/' - it is the same public site and gets the
    // same previewer, but naively joining would show `…web.app/` where every
    // other page shows a clean path.
    component.path = '/';

    expect(component.shownUrl).toBe(environment.previewSiteUrl);
  });

  // -------------------------------------------------------------- hover
  //
  // Hovering a row in the section list outlines that section on the page.
  // The site is asked WHERE the section is and answers with a rectangle in
  // its own pixels; the outline is drawn here, scaled like the frame.

  const SITE = new URL(environment.previewSiteUrl).origin;
  const postFrom = (data: unknown, origin: string) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  const hover = (key: string | null) => {
    component.highlightKey = key;
    component.ngOnChanges({ highlightKey: {} } as never);
  };
  const rect = (key: string) =>
    ({ impactPreviewHighlightRect: { key, top: 1000, left: 0, width: 1440, height: 500 } });

  it('does NOT reload the frame for a hover - it would blank on every mouse movement', () => {
    component.ngOnChanges(reload);
    const before = String(component.src);

    hover('overview');
    hover('faq');
    hover(null);

    expect(String(component.src)).toBe(before);
  });

  it('draws the outline where the site says the section is, at the frame\'s scale', () => {
    component.device = 'desktop';
    hover('overview');

    postFrom(rect('overview'), SITE);

    const s = 430 / 1440;
    expect(component.highlightBox).toEqual({
      top: Math.round(1000 * s), left: 0, width: 430, height: Math.round(500 * s)
    });
  });

  it('ignores a rectangle for a row that is no longer hovered', () => {
    // Replies arrive a round trip after the hover, so on a fast sweep down
    // the list the answer to row three can land after row five is hovered.
    hover('overview');
    hover('faq');

    postFrom(rect('overview'), SITE);

    expect(component.highlightBox).toBeNull();
  });

  it('believes a rectangle only from the framed site', () => {
    hover('overview');

    postFrom(rect('overview'), 'https://somewhere-else.example');

    expect(component.highlightBox).toBeNull();
  });

  it('takes the outline down the moment the hover ends, without waiting for a reply', () => {
    hover('overview');
    postFrom(rect('overview'), SITE);
    expect(component.highlightBox).not.toBeNull();

    hover(null);

    expect(component.highlightBox).toBeNull();
  });

  it('drops the outline on a reload - it belonged to the page going away', () => {
    hover('overview');
    postFrom(rect('overview'), SITE);

    component.revision++;
    component.ngOnChanges(reload);

    expect(component.highlightBox).toBeNull();
  });

  it('drops a rectangle that is not one', () => {
    hover('overview');
    for (const bad of [
      null,
      'overview',
      { key: 'overview' },
      { key: 'overview', top: -1, left: 0, width: 10, height: 10 },
      { key: 'overview', top: 'a', left: 0, width: 10, height: 10 },
      { key: '', top: 0, left: 0, width: 10, height: 10 }
    ]) {
      postFrom({ impactPreviewHighlightRect: bad }, SITE);
    }

    expect(component.highlightBox).toBeNull();
  });
});
