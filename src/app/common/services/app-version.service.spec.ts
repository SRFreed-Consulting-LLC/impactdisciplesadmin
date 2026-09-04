import { TestBed } from '@angular/core/testing';
import { Injectable } from '@angular/core';
import {
  AppVersionService,
  pickBuildChunk,
  scriptSrcsFromHtml
} from './app-version.service';

// The failure this guards against is silent: a tab running code that no longer
// exists on the server hangs rather than erroring, so every one of these tests
// is really asking "would we have told the user?".

describe('scriptSrcsFromHtml', () => {
  it('pulls every script src out of an index.html', () => {
    const html = `<html><head>
      <script src="runtime-AAA.js" type="module"></script>
      <script src="/polyfills-BBB.js"></script>
      </head><body><script src="main-CCC.js"></script></body></html>`;
    expect(scriptSrcsFromHtml(html))
      .toEqual(['runtime-AAA.js', '/polyfills-BBB.js', 'main-CCC.js']);
  });

  it('is unbothered by html with no scripts, or none at all', () => {
    expect(scriptSrcsFromHtml('<html></html>')).toEqual([]);
    expect(scriptSrcsFromHtml('')).toEqual([]);
  });
});

describe('pickBuildChunk', () => {
  it('picks the main bundle, not runtime or polyfills', () => {
    // Keying on runtime or polyfills would miss real updates: those can come
    // out of a build byte-identical while application code has changed.
    expect(pickBuildChunk([
      'runtime-AAA.js', 'polyfills-BBB.js', 'main-CCC.js'
    ])).toBe('main-CCC.js');
  });

  it('strips any path and query so only the filename is compared', () => {
    expect(pickBuildChunk(['/assets/js/main-CCC.js?v=2'])).toBe('main-CCC.js');
  });

  it("recognises ng serve's unhashed main.js", () => {
    // It never changes, so local development sees no prompt - which is the
    // intent, not an oversight.
    expect(pickBuildChunk(['main.js'])).toBe('main.js');
  });

  it('returns null rather than guessing when there is no main bundle', () => {
    expect(pickBuildChunk(['runtime-AAA.js', 'vendor.js'])).toBeNull();
    expect(pickBuildChunk([])).toBeNull();
  });

  it('does not mistake a lookalike for the main bundle', () => {
    expect(pickBuildChunk(['maintenance-AAA.js'])).toBeNull();
    expect(pickBuildChunk(['main-CCC.js.map'])).toBeNull();
  });
});

describe('AppVersionService', () => {
  // Overriding DOCUMENT wholesale breaks TestBed teardown (it calls
  // node.remove() on the real document), so the script-source seam is what the
  // tests replace - which is exactly why the service exposes it.
  @Injectable()
  class TestVersionService extends AppVersionService {
    srcs: string[] = [];
    protected override currentScriptSrcs(): string[] {
      return this.srcs;
    }
  }

  /** Builds the service with scripted boot sources and a scripted fetch. */
  function setup(bootedSrc: string, servedHtml: string | Error | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [TestVersionService] });
    const service = TestBed.inject(TestVersionService);
    service.srcs = [bootedSrc];

    const calls: string[] = [];
    spyOn(window, 'fetch').and.callFake((input: RequestInfo | URL) => {
      calls.push(String(input));
      if (servedHtml instanceof Error) return Promise.reject(servedHtml);
      if (servedHtml === null) {
        return Promise.resolve({ ok: false, text: () => Promise.resolve('') } as Response);
      }
      return Promise.resolve(
        { ok: true, text: () => Promise.resolve(servedHtml) } as Response
      );
    });

    let announced = false;
    service.newVersionAvailable$.subscribe((v) => { announced = announced || v; });
    // A huge interval: every test drives check() itself, so no timer fires.
    service.start(60 * 60 * 1000);
    return { service, calls, announced: () => announced };
  }

  afterEach(() => TestBed.inject(TestVersionService).stop());

  it('announces a new version when the served main chunk differs', async () => {
    const t = setup('main-OLD.js', '<script src="main-NEW.js"></script>');

    expect(await t.service.check()).toBeTrue();
    expect(t.announced()).toBeTrue();
  });

  it('stays quiet when the server is serving the same build', async () => {
    const t = setup('main-SAME.js', '<script src="main-SAME.js"></script>');

    expect(await t.service.check()).toBeFalse();
    expect(t.announced()).toBeFalse();
  });

  it('cache-busts the request, or it would ask a cache the same question', async () => {
    const t = setup('main-OLD.js', '<script src="main-NEW.js"></script>');
    await t.service.check();
    expect(t.calls[0]).toContain('index.html?_=');
  });

  it('announces only once and then stops polling', async () => {
    const t = setup('main-OLD.js', '<script src="main-NEW.js"></script>');

    expect(await t.service.check()).toBeTrue();
    const after = t.calls.length;
    // The answer cannot change back, and the prompt is already showing.
    expect(await t.service.check()).toBeTrue();
    expect(t.calls.length).toBe(after);
  });

  it('says nothing when the network fails - a flaky check must not nag', async () => {
    const t = setup('main-OLD.js', new Error('offline'));

    expect(await t.service.check()).toBeFalse();
    expect(t.announced()).toBeFalse();
  });

  it('says nothing on a non-OK response', async () => {
    const t = setup('main-OLD.js', null);

    expect(await t.service.check()).toBeFalse();
    expect(t.announced()).toBeFalse();
  });

  it('does nothing at all when this tab cannot be fingerprinted', async () => {
    // A prompt that might be wrong teaches people to dismiss it, so no
    // fingerprint means no polling rather than a guess.
    const t = setup('vendor-only.js', '<script src="main-NEW.js"></script>');

    expect(await t.service.check()).toBeFalse();
    expect(t.calls.length).toBe(0);
    expect(t.announced()).toBeFalse();
  });
});
