import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { SitePagesNavService } from './site-pages-nav.service';

/**
 * THE LEFT NAV'S PAGE LIST.
 *
 * The service had no spec until 2026-09-05, and the thing worth pinning is
 * not what it maps - it is HOW MANY FIRESTORE LISTENERS IT OPENS.
 *
 * `leaves$` and `pages$` each used to call `streamAll()` under a comment
 * saying they shared a stream. They did not: `FirebaseDAO.streamAll()` builds
 * a fresh `collectionData(query(collection(...)))` per call, so it is a COLD
 * observable, and both were `shareReplay({refCount: false})` and subscribed
 * in the constructor - two permanent `onSnapshot` listeners on `page_content`
 * for the whole session, where the design intends one.
 *
 * That is invisible from the app: the nav renders correctly either way. Only
 * a count catches it, so a count is what this asserts.
 */
describe('the site pages nav service', () => {
  let calls: number;
  let source: Subject<PageContentModel[]>;

  function build(): SitePagesNavService {
    calls = 0;
    source = new Subject<PageContentModel[]>();
    TestBed.configureTestingModule({
      providers: [
        SitePagesNavService,
        {
          provide: PageContentService,
          useValue: {
            streamAll: (): Observable<PageContentModel[]> => {
              calls++;
              return source.asObservable();
            }
          }
        }
      ]
    });
    return TestBed.inject(SitePagesNavService);
  }

  /** A kit page as page_content stores one. */
  function page(id: string, title: string, extra: Partial<PageContentModel> = {}) {
    return { id, title, blocks: [], theme: { surface: 'light' }, ...extra } as PageContentModel;
  }

  it('opens exactly ONE listener however many projections read it', () => {
    // The whole point of the file. Both projections are subscribed in the
    // constructor, so this counts what the session actually holds open.
    build();

    expect(calls)
      .withContext('page_content is being streamed more than once')
      .toBe(1);
  });

  it('still opens one listener after both projections are subscribed again', () => {
    // shareReplay with refCount:false means a late subscriber must attach to
    // the existing stream rather than starting another.
    const service = build();
    service.leaves$.subscribe();
    service.pages$.subscribe();
    service.leaves$.subscribe();

    expect(calls).toBe(1);
  });

  it('puts Home first and the rest alphabetically', () => {
    // Home became an ordinary kit page and would otherwise sort between Give
    // and Lunch and Learns - the site's front page buried mid-list.
    const service = build();
    source.next([
      page('seminars', 'Seminars'),
      page('home', 'Home'),
      page('about-us', 'About Us')
    ]);

    expect(service.leaves.map((l) => l.slug)).toEqual(['home', 'about-us', 'seminars']);
  });

  it('labels a page by its title and keys it by its slug', () => {
    // These two feed the drawer, TabShell selection, ?tab=<slug> deep links
    // and the permission key convention (page-manager.<slug>) - four things
    // that break together if either half moves.
    const service = build();
    source.next([page('coaching-with-impact', 'Coaching with Impact')]);

    expect(service.leaves[0]).toEqual({
      label: 'Coaching with Impact', slug: 'coaching-with-impact'
    });
  });

  it('leaves a titleless page out of the nav entirely', () => {
    // `isKitPage()` is `!!page?.title`, so a document with no title is not a
    // page as far as the nav is concerned and never reaches the mapping. That
    // is the right behaviour - a leaf with a blank label is an unclickable
    // empty row - but it is worth pinning, because it also means the
    // `?? page.id ?? ''` fallbacks in both projections are UNREACHABLE. If
    // isKitPage ever loosens, those fallbacks start mattering and this test
    // is what says so.
    const service = build();
    source.next([
      page('untitled', undefined as unknown as string),
      page('real', 'A real page')
    ]);

    expect(service.leaves.map((l) => l.slug)).toEqual(['real']);
  });

  it('reads an absent isPublished as published', () => {
    // Pages written before the flag existed are served, so absent means
    // published - the same reading the public site's own route takes. Get it
    // backwards and the menu picker calls every older page unpublished.
    const service = build();
    source.next([
      page('old', 'Older page'),
      page('draft', 'A draft', { isPublished: false } as Partial<PageContentModel>),
      page('live', 'Published', { isPublished: true } as Partial<PageContentModel>)
    ]);

    const bySlug = new Map(service.pages.map((p) => [p.slug, p.isPublished]));
    expect(bySlug.get('old')).toBe(true);
    expect(bySlug.get('draft')).toBe(false);
    expect(bySlug.get('live')).toBe(true);
  });

  it('survives the stream emitting nothing', () => {
    // streamAll() falls back to [] on a terminal error rather than throwing,
    // so an empty emission is a real state and not a hypothetical.
    const service = build();
    source.next([]);

    expect(service.leaves).toEqual([]);
    expect(service.pages).toEqual([]);
  });
});
