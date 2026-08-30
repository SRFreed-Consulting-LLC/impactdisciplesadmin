import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { RESERVED_SLUGS, isSlugAvailable } from '@impact-common/shared/lists/site_routes';
import { SECTION_SURFACES, SectionSurface } from '@impact-common/shared/lists/section_kit';

export interface NewPageResult {
  slug: string;
  title: string;
  surface: Exclude<SectionSurface, 'inherit'>;
}

/**
 * Naming a new page.
 *
 * THREE DECISIONS, and only three: what it is called, where it lives, and
 * what colour it mostly is. Everything else about a page is a section, and
 * sections are added on the next screen - a wizard that asked for content
 * here would be asking before there is anything to say.
 *
 * THE SLUG IS THE HARD PART, and it is why this is a dialog rather than an
 * inline "+" that invents a name. A slug is the document id AND the public
 * URL, it cannot be changed afterwards without breaking every link to it, and
 * a page named after a segment the web app already routes would save cleanly,
 * appear in the menu, and open somebody else's screen. Nothing would report
 * it. So the refusal happens here, before the document exists.
 */
@Component({
  selector: 'app-new-page-dialog',
  templateUrl: './new-page-dialog.component.html',
  styleUrls: ['./new-page-dialog.component.css'],
  standalone: false
})
export class NewPageDialogComponent {
  title = '';
  slug = '';
  surface: Exclude<SectionSurface, 'inherit'> = 'light';

  /** Whether the slug was typed by hand. Once it has been, the title stops
   *  overwriting it - otherwise correcting a slug is impossible while the
   *  title is still being written. */
  private slugEdited = false;

  readonly surfaces = SECTION_SURFACES.filter((s) => s.key !== 'inherit');

  constructor(
    private dialog: MatDialogRef<NewPageDialogComponent, NewPageResult>,
    @Inject(MAT_DIALOG_DATA) public data: { existingSlugs: readonly string[] }
  ) {}

  onTitle(value: string): void {
    this.title = value;
    if (!this.slugEdited) {
      this.slug = this.slugify(value);
    }
  }

  onSlug(value: string): void {
    this.slugEdited = true;
    this.slug = value.trim().toLowerCase();
  }

  /** Lower-case words joined by single hyphens - the one shape the router's
   *  matcher can see, and the shape isSlugAvailable() insists on. */
  private slugify(value: string): string {
    return (value || '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** What is wrong with the slug, as a sentence, or null. Written as one
   *  function so the message and the disabled state cannot disagree. */
  get slugProblem(): string | null {
    if (!this.slug) {
      return null; // nothing typed yet is not an error, just not ready
    }
    if (RESERVED_SLUGS.includes(this.slug)) {
      return `The site already uses /${this.slug} for something else. `
        + 'A page here would never be reachable.';
    }
    if (!isSlugAvailable(this.slug)) {
      return 'Use lower-case letters, numbers and single hyphens - no spaces, '
        + 'slashes or punctuation.';
    }
    if (this.data.existingSlugs.includes(this.slug)) {
      return `There is already a page at /${this.slug}.`;
    }
    return null;
  }

  get canCreate(): boolean {
    return !!this.title.trim() && !!this.slug && !this.slugProblem;
  }

  create(): void {
    if (!this.canCreate) {
      return;
    }
    this.dialog.close({ slug: this.slug, title: this.title.trim(), surface: this.surface });
  }

  cancel(): void {
    this.dialog.close();
  }
}
