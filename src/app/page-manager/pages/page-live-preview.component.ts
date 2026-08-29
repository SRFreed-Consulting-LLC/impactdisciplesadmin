import { Component, Input, OnInit, inject } from '@angular/core';
import { PageContentBlock, PageContentItem } from '@impact-common/shared/models/domain/page-content.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { WebConfigModel } from '@impact-common/shared/models/utils/web-config.model';
import { WebConfigService } from 'src/app/common/services/data/web-config.service';
import { environment } from 'src/environments/environment';
import { EditablePage, PreviewShape, kindFor } from './page-section-catalogue';
import { PreviewDevice } from '../home/home-live-preview.component';

/**
 * The whole public page in miniature, in the order the stack says.
 *
 * Same trade as the home page's preview: recognisable BANDS - right shape,
 * right pictures, right words - and no attempt at the real typography. It is
 * here to be counted and ordered, not proofread.
 *
 * SHAPES, NOT TYPES. A section type says what a block IS; a shape says how it
 * LOOKS in outline, and several types share one - a story column, a copy-with-
 * video and an equipping overview are all a `split`. That is what keeps this
 * one component able to draw all eleven pages instead of a switch per page.
 *
 * It derives the alternating sides the SAME way the public pages do - from
 * each block's position among blocks of its own type, and from each entry's
 * position within its list. Getting that wrong here would make the preview
 * lie about the one thing staff are most likely to change.
 */
@Component({
  selector: 'app-page-live-preview',
  templateUrl: './page-live-preview.component.html',
  styleUrls: ['./page-live-preview.component.css'],
  standalone: false
})
export class PageLivePreviewComponent implements OnInit {
  private readonly webConfigService = inject(WebConfigService);

  @Input({ required: true }) page!: EditablePage;

  /** Live sections only, in page order. */
  @Input() sections: readonly PageContentBlock[] = [];

  @Input() device: PreviewDevice = 'desktop';

  /**
   * The real prices, so a price tile shows the figure a visitor will see.
   *
   * Read here rather than passed in because only two pages have prices, and
   * the service caches its one fetch for the session - so this costs nothing
   * on the other nine.
   */
  private webConfig: WebConfigModel | null = null;

  async ngOnInit(): Promise<void> {
    try {
      this.webConfig = (await this.webConfigService.getAll())[0] ?? null;
    } catch {
      // A preview without a price is worth more than a preview that throws.
      this.webConfig = null;
    }
  }

  get isMobile(): boolean {
    return this.device === 'mobile';
  }

  /** Contact is one row of two halves; everything else stacks. */
  get isHorizontal(): boolean {
    return !!this.page.horizontal && !this.isMobile;
  }

  shapeOf(section: PageContentBlock): PreviewShape | 'unknown' {
    return kindFor(this.page, section.type)?.preview ?? 'unknown';
  }

  labelOf(section: PageContentBlock): string {
    return kindFor(this.page, section.type)?.label ?? section.type ?? 'section';
  }

  /**
   * Strips markup - a heading may carry <strong>, and this is an 11px band.
   *
   * A LINE BREAK BECOMES A SPACE, and so does the end of a block. Stripping
   * every tag alike ran two lines together: the Discipleship Library's hero
   * is "Your discipleship library,<br>in your pocket." and the preview read
   * "library,in your pocket". Inline tags still close up, because
   * `EQUIPPING <strong>PASTORS</strong>` already carries its own space and a
   * second one would show.
   */
  plain(html: string | undefined): string {
    return (html ?? '')
      .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|ul|ol|tr)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * A picture's address AS THIS SCREEN CAN LOAD IT - which is not always the
   * address the public page uses.
   *
   * Most pictures are absolute Firebase Storage URLs and need nothing. The
   * Discipleship Library's screenshots are the exception: they ship with the
   * WEB BUILD as `assets/reader/...`, so the browser resolves them against
   * whatever origin is asking - and the admin does not have those files.
   * Eight of them 404'd here, which is how this was found; the preview showed
   * eight grey rectangles and the console filled up.
   *
   * Resolved against the public site because that is what the preview is a
   * picture OF. A staff member who replaces one gets a Storage URL and this
   * stops applying to it.
   */
  src(image: ImageModel | undefined): string | null {
    const url = image?.url;
    if (!url) {
      return null;
    }
    if (/^(https?:|data:|blob:)/i.test(url)) {
      return url;
    }
    return `${environment.publicSiteUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }

  /** The same, ready to drop into a background-image. */
  bg(image: ImageModel | undefined): string | null {
    const url = this.src(image);
    return url ? `url(${url})` : null;
  }

  liveEntries(section: PageContentBlock): PageContentItem[] {
    return (section.items ?? []).filter((e) => e.isActive);
  }

  entriesIn(section: PageContentBlock, column: 'left' | 'right'): PageContentItem[] {
    return this.liveEntries(section).filter((e) =>
      column === 'right' ? e.column === 'right' : e.column !== 'right');
  }

  /**
   * True when this section draws its picture on the LEFT.
   *
   * Counts position among sections OF THE SAME TYPE, exactly like the public
   * page - not position in the stack, which would disagree the moment a
   * banner sat between two story columns.
   */
  pictureLeft(section: PageContentBlock): boolean {
    return this.typeIndex(section) % 2 === 1;
  }

  private typeIndex(section: PageContentBlock): number {
    let n = 0;
    for (const s of this.sections) {
      if (s.key === section.key) {
        return n;
      }
      if (s.type === section.type) {
        n++;
      }
    }
    return n;
  }

  /** Timeline entries and feature rows both alternate from their own
   *  position within the list. */
  entryOnLeft(i: number): boolean {
    return i % 2 === 0;
  }

  chip(i: number): string {
    return String(i + 1).padStart(2, '0');
  }

  /**
   * The price line as a visitor sees it, resolved from Web Config.
   *
   * Empty where the entry names no figure or the figure cannot be resolved -
   * the same rule the public pages follow, because a preview that showed "$0"
   * where the site shows nothing would be the wrong kind of wrong.
   */
  priceLabel(entry: PageContentItem): string {
    if (!entry.amountKey || !this.webConfig) {
      return '';
    }
    const value = (this.webConfig as unknown as Record<string, unknown>)[entry.amountKey];
    return typeof value === 'number' ? `$${value}${entry.amountSuffix ?? ''}` : '';
  }
}
