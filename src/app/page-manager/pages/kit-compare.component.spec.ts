import { TestBed } from '@angular/core/testing';
import { KitCompareComponent } from './kit-compare.component';

// TestBed as an injector only - the class takes DomSanitizer via inject().

describe('the compare view', () => {
  afterEach(() => TestBed.resetTestingModule());

  function build(): KitCompareComponent {
    TestBed.configureTestingModule({});
    const component = TestBed.runInInjectionContext(() => new KitCompareComponent());
    component.path = '/lunch-and-learns';
    component.slug = 'lunch-and-learns';
    component.ngOnChanges();
    return component;
  }

  it('keeps both frame urls REFERENTIALLY STABLE across reads', () => {
    // THE BLINK. As getters these built a fresh SafeResourceUrl object per
    // change-detection read; Angular compares by reference, saw a "new" src
    // every cycle, re-set it - and setting an iframe's src reloads the
    // iframe. Both frames reloaded continuously and the comparison was
    // unreadable. Same referential-stability rule as the kitPage() freeze:
    // reading twice must give the SAME object.
    const component = build();

    expect(component.liveUrl).not.toBeNull();
    expect(component.liveUrl).toBe(component.liveUrl);
    expect(component.kitUrl).toBe(component.kitUrl);

    const before = component.liveUrl;
    // a change-detection pass reads again; nothing changed, so same object
    expect(component.liveUrl).toBe(before);
  });

  it('rebuilds the urls when the inputs genuinely change', () => {
    // Stable is not frozen - switching pages must re-point the frames.
    const component = build();
    const before = component.kitUrl;

    component.slug = 'about-us';
    component.path = '/about-us';
    component.ngOnChanges();

    expect(component.kitUrl).not.toBe(before);
  });

  it('sends the kit side to the FRAMED preview of the same slug', () => {
    const component = build();
    const url = String(component.kitUrl);

    expect(url).toContain('/kit-preview/lunch-and-learns');
    expect(url).toContain('framed=1');
  });
});
