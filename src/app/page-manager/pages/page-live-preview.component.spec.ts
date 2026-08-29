import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { PageLivePreviewComponent } from './page-live-preview.component';
import { pageFor } from './page-section-catalogue';
import { environment } from 'src/environments/environment';

// TestBed as an INJECTOR: this component takes DomSanitizer, NgZone and
// DestroyRef through inject(), so `new`-ing it throws NG0203. Nothing here
// needs a rendered template.
describe('PageLivePreviewComponent', () => {
  let component: PageLivePreviewComponent;

  const post = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data }));

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PageLivePreviewComponent] });
    component = TestBed.inject(PageLivePreviewComponent);
    component.page = pageFor('seminars')!;
  });

  it('frames the page it was given, on the site this admin is paired with', () => {
    component.ngOnChanges();

    const url = TestBed.inject(DomSanitizer)
      .sanitize(SecurityContext.RESOURCE_URL, component.src!) ?? '';

    expect(url).toContain(environment.previewSiteUrl);
    expect(url).toContain('/seminars');
  });

  it('changes the address on every revision - the only way to reload a frame', () => {
    component.revision = 1;
    component.ngOnChanges();
    const first = String(component.src);

    component.revision = 2;
    component.ngOnChanges();

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

  it('names the address it is showing, without the cache-buster', () => {
    // So nobody debugs a stale deployed build thinking it is their own work.
    expect(component.shownUrl).toBe(`${environment.previewSiteUrl}/seminars`);
    expect(component.shownUrl).not.toContain('adminPreview');
  });
});
