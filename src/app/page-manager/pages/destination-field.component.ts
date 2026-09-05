import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import menuData from 'src/app/common/services/data/nav-menu-data';

export interface Destination {
  text: string;
  value: string;
}

/** The value the picker uses for "somewhere this list does not name". */
const EXTERNAL = 'external';

/**
 * Where a button goes: a pick-list of the site's own pages, or any address
 * at all.
 *
 * IT FIXES A REAL BUG. The section editor used to bind the pick-list straight
 * to `ctaUrl`, and the list carried an "External" option - so choosing it
 * stored the literal string `external` and the button linked to `/external`.
 * There was nowhere to type an address, which made the option worse than
 * useless: it looked like the way to link somewhere else and quietly broke
 * the link instead.
 *
 * WHAT IS STORED IS ALWAYS THE REAL ADDRESS. The dropdown is a shortcut, not
 * a second representation - so nothing has to stay in step, and an address
 * the list happens to gain later starts showing as its friendly name on its
 * own. Anything the list does not name selects External and shows the box.
 *
 * That matters more since 2026-08-29, when the Coaching with Impact page's
 * destinations became editable: two of them are product deep links and one is
 * a Kajabi course, none of which are in a nav menu.
 */
@Component({
  selector: 'app-destination-field',
  templateUrl: './destination-field.component.html',
  styleUrls: ['./destination-field.component.css'],
  standalone: false
})
export class DestinationFieldComponent implements OnChanges {
  @Input() label = 'Button goes to';
  @Input() url?: string;
  @Output() urlChange = new EventEmitter<string | undefined>();

  readonly destinations: Destination[] = buildDestinations();

  /** Which row of the pick-list is showing - derived from `url`, never
   *  stored. */
  mode = '';

  ngOnChanges(): void {
    this.mode = this.modeFor(this.url);
  }

  get isExternal(): boolean {
    return this.mode === EXTERNAL;
  }

  onModeChange(value: string): void {
    this.mode = value;
    // Choosing External clears the address rather than leaving the last
    // page selected underneath it - the box below is then obviously the
    // thing to fill in.
    this.urlChange.emit(value === EXTERNAL ? '' : value);
  }

  onUrlTyped(value: string): void {
    this.urlChange.emit(value);
  }

  /** A stored address the list names shows as that name; anything else is
   *  External, including an empty one once staff have chosen it. */
  private modeFor(url: string | undefined): string {
    if (!url) {
      return this.mode === EXTERNAL ? EXTERNAL : '';
    }
    return this.destinations.some((d) => d.value === url) ? url : EXTERNAL;
  }
}

/**
 * The site's own pages, from the public nav, plus the two that are not in it:
 * an anchor on About Us that its story buttons point at, and External.
 */
function buildDestinations(): Destination[] {
  const list: Destination[] = [];
  menuData.forEach((menu) => {
    list.push({ text: menu.title, value: menu.link ?? '' });
    if (menu.hasDropdown) {
      (menu.dropdownItems ?? []).forEach((dd) => list.push({ text: dd.title, value: dd.link ?? '' }));
    }
  });
  list.push({ text: 'The banner on this page', value: '#history' });
  list.push({ text: 'Somewhere else…', value: EXTERNAL });
  return list;
}
