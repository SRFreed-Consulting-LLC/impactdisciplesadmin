import { Component, Input } from '@angular/core';

/** What the bar needs to draw itself. The editor hands over its live form
 *  value, so this follows what is being typed rather than what is saved. */
export interface DockPreview {
  label?: string;
  message?: string;
  note?: string;
  buttons: string[];
}

/**
 * THE DOCKING BAR AS THE SITE DRAWS IT, on its own.
 *
 * NOT a framed page, unlike the header and whole-page previews beside it,
 * and that is a deliberate trade Shane picked (2026-09-01). The bar is fixed
 * to the bottom of the WINDOW, can be dismissed by the visitor, and hides
 * itself on checkout and on any page its own buttons point at - so a frame
 * of the real site would show an empty strip about as often as it showed the
 * thing being edited, and an editor whose preview is legitimately blank is
 * an editor nobody trusts.
 *
 * THE COST OF THAT, said out loud: this is a RENDERING of the bar rather
 * than the bar itself, so it can drift from the site. The styles below are
 * copied from library-dock.component.scss in the web app and every value is
 * commented with where it came from. If that file changes, this has to be
 * changed with it - the check that would catch a drift does not exist,
 * because the two apps do not share a stylesheet.
 *
 * It draws the bar's LAYOUT truthfully: the eyebrow, the headline with its
 * muted note, one or two buttons where the last is solid and any before it
 * are ghosts, and the dismiss cross. What it does not attempt is the page
 * behind it.
 */
@Component({
  selector: 'app-docking-bar-preview',
  templateUrl: './docking-bar-preview.component.html',
  styleUrls: ['./docking-bar-preview.component.scss'],
  standalone: false
})
export class DockingBarPreviewComponent {
  @Input({ required: true }) dock!: DockPreview;

  /** True when the bar has nothing to say. `message` is the one field the
   *  real bar cannot render without - an announcement with no announcement
   *  is nothing - so the preview says so rather than drawing an empty bar
   *  that looks like a styling fault. */
  get empty(): boolean {
    return !(this.dock?.message ?? '').trim();
  }

  /** Buttons with something written on them, in order. The LAST is the solid
   *  one and any before it are ghosts, so a pair reads secondary-then-primary
   *  and a lone button is always solid - the site's own rule. */
  get buttons(): string[] {
    return (this.dock?.buttons ?? []).map((b) => (b ?? '').trim()).filter(Boolean);
  }
}
