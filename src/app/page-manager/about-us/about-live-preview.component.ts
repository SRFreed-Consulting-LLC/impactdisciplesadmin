import { Component, Input } from '@angular/core';
import { PageContentBlock, PageContentItem } from '@impact-common/shared/models/domain/page-content.model';
import { PAGE_SECTION_TYPES } from '@impact-common/shared/lists/page_section_types.enum';
import { PreviewDevice } from '../home/home-live-preview.component';

/**
 * The whole About Us page in miniature, in the order the stack says.
 *
 * Same trade as the home page's preview: recognisable BANDS, right shape,
 * right pictures, right words, no attempt at the real typography. It is
 * here to be counted and ordered, not proofread.
 *
 * It derives the alternating sides the SAME way the public page does -
 * from each block's position among blocks of its own type - so dragging a
 * section shows you immediately which way round the next one flips. Getting
 * that wrong here would make the preview lie about the one thing staff are
 * most likely to change.
 */
@Component({
  selector: 'app-about-live-preview',
  templateUrl: './about-live-preview.component.html',
  styleUrls: ['./about-live-preview.component.css'],
  standalone: false
})
export class AboutLivePreviewComponent {
  readonly types = PAGE_SECTION_TYPES;

  /** Live sections only, in page order. */
  @Input() sections: readonly PageContentBlock[] = [];

  @Input() device: PreviewDevice = 'desktop';

  get isMobile(): boolean {
    return this.device === 'mobile';
  }

  /** Strips markup - a heading may carry <strong>, and this is a 11px band. */
  plain(html: string | undefined): string {
    return (html ?? '').replace(/<[^>]+>/g, '').trim();
  }

  liveEntries(section: PageContentBlock): PageContentItem[] {
    return (section.items ?? []).filter((e) => e.isActive);
  }

  /**
   * True when this story column draws its picture on the left.
   *
   * Counts position among STORY blocks, exactly like the public page - not
   * position in the stack, which would disagree the moment a banner sat
   * between two story columns.
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

  entryOnLeft(i: number): boolean {
    return i % 2 === 0;
  }
}
