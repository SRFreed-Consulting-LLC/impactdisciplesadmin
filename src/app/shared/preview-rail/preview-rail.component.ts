import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';

export type PreviewDevice = 'web' | 'phone';

/**
 * The right-hand preview rail's CHROME, without any idea what it is
 * previewing: a collapse-to-a-strip toggle and a web/phone device switch,
 * both remembered across visits. Whatever a host projects into it is what
 * gets shown, inside a phone frame when phone is selected.
 *
 * Extracted from the summit rail (`summit-preview-rail`), which pairs the
 * same chrome with summit-specific content and a third APP view that only
 * a summit has. That component keeps its own copy rather than being
 * rebuilt on this one: it is 30-odd references deep into agendas,
 * breakouts, FAQs and dining, and untangling it buys nothing here.
 *
 * `storageKey` is per-screen ON PURPOSE. An admin who collapses the rail
 * while editing a product has said nothing about how they want to see
 * testimonials, and one global key would make every screen fight over the
 * same preference.
 */
@Component({
  selector: 'app-preview-rail',
  templateUrl: './preview-rail.component.html',
  styleUrls: ['./preview-rail.component.scss'],
  standalone: false
})
export class PreviewRailComponent implements OnChanges {
  /** Distinct per screen - see the class comment. */
  @Input({ required: true }) storageKey!: string;
  /** Shown in the rail's header, e.g. "Public page". */
  @Input() label = 'Preview';
  /** Hosts with nothing worth showing on a phone can hide the switch. */
  @Input() showDeviceSwitch = true;
  /**
   * How the device switch is drawn. 'icons' (the default, and what the six
   * existing hosts get) is the compact desktop/phone icon pair. 'segmented'
   * is the bordered WEB | PHONE control the SUMMIT rail uses - asked for on
   * the events editor (owner, 2026-08-27) so the two event surfaces carry
   * the same switch. Deliberately an opt-in rather than a global change:
   * nothing about the other six screens was in question.
   */
  @Input() deviceStyle: 'icons' | 'segmented' = 'icons';
  /** Rail width in px when open. A full-page editor can afford the default;
   *  inside a dialog it has to leave the form the larger share. */
  @Input() width = 420;

  /** Readable by a host through a template reference - see ngOnChanges
   *  for why it is settled before the first render. */
  device: PreviewDevice = 'web';
  collapsed = false;

  private loaded = false;

  /**
   * A CHANGING storageKey re-reads, which is what lets a key carry the
   * thing being edited: `page-stack:seminars` and `page-stack:home`
   * remember separately, so an admin who folds the preview away on one page
   * has said nothing about the next (Shane, 2026-08-31).
   *
   * Loading HERE rather than only lazily from the template also settles the
   * order for a host that reads `device` off a template reference: this runs
   * before anything renders, so the projected content sees the stored choice
   * on its first pass rather than the default and then a correction.
   *
   * Every existing host passes a constant key and is unaffected.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['storageKey']) {
      this.loaded = false;
      this.load();
    }
  }

  private load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const stored = JSON.parse(localStorage.getItem(this.key()) ?? '{}');
      if (stored.device === 'web' || stored.device === 'phone') {
        this.device = stored.device;
      }
      this.collapsed = stored.collapsed === true;
    } catch {
      // First run, or storage unavailable - the defaults stand.
    }
  }

  /** Called from the template so the stored state is applied on first
   *  render, once storageKey exists. */
  get state(): { device: PreviewDevice; collapsed: boolean } {
    this.load();
    return { device: this.device, collapsed: this.collapsed };
  }

  setDevice(device: PreviewDevice): void {
    this.device = device;
    this.persist();
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.persist();
  }

  private key(): string {
    return `preview-rail:${this.storageKey}`;
  }

  private persist(): void {
    try {
      localStorage.setItem(this.key(),
        JSON.stringify({ device: this.device, collapsed: this.collapsed }));
    } catch {
      // Storage unavailable - the rail still works, it just forgets.
    }
  }
}
