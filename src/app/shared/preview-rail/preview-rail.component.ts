import { Component, Input } from '@angular/core';

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
export class PreviewRailComponent {
  /** Distinct per screen - see the class comment. */
  @Input({ required: true }) storageKey!: string;
  /** Shown in the rail's header, e.g. "Public page". */
  @Input() label = 'Preview';
  /** Hosts with nothing worth showing on a phone can hide the switch. */
  @Input() showDeviceSwitch = true;

  device: PreviewDevice = 'web';
  collapsed = false;

  private loaded = false;

  /** Read lazily rather than in the constructor: storageKey is an @Input
   *  and is not set yet when the constructor runs. */
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
