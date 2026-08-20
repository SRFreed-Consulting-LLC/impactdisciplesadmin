import { Component, Input } from '@angular/core';
import { itemTitle } from 'src/app/events-manager/events/event-agenda/session-block.util';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';
import { SummitPreviewData } from '../summit-preview/summit-preview.component';

type RailView = 'web' | 'phone' | 'app';

// Which preview the admin last used + whether the rail is open - remembered
// across screens/sessions (mirrors ThemeService's localStorage convention;
// a per-admin Firestore field was considered overkill for a view toggle).
const STORAGE_KEY = 'summit-preview-rail';

// The always-on right-side preview rail for the summit surfaces (Mission
// Control, every editor section, every wizard step - user request
// 2026-08-20, mockup approved). Three views behind one switch:
//   WEB   - the full public summit page (app-summit-preview) at rail width.
//   PHONE - the same page inside a phone frame at handset width.
//   APP   - a phone frame of the ATTENDEE experience: check-in
//           instructions, dining, agenda summary, what's next, FAQs - the
//           App Content material the web page doesn't show.
// Every view always renders the WHOLE summit regardless of which section
// is being edited; hosts feed live values so edits appear as you type.
// Collapsible to a thin strip (the Agenda grid especially wants width).
@Component({
    selector: 'app-summit-preview-rail',
    templateUrl: './summit-preview-rail.component.html',
    styleUrls: ['./summit-preview-rail.component.scss'],
    standalone: false
})
export class SummitPreviewRailComponent {
  @Input() data: SummitPreviewData = {};

  view: RailView = 'web';
  collapsed = false;

  constructor() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      if (['web', 'phone', 'app'].includes(stored.view)) {
        this.view = stored.view;
      }
      this.collapsed = stored.collapsed === true;
    } catch {
      // First run / corrupt storage - defaults stand.
    }
  }

  setView(view: RailView): void {
    this.view = view;
    this.persist();
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.persist();
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ view: this.view, collapsed: this.collapsed }));
  }

  // ---- APP view derivations ----

  // Chronological schedule summary - every item, plain rows (the real app
  // renders richer, but the preview's job is "is my content there and
  // right", not pixel parity).
  agendaRows(): { title: string; time: string }[] {
    const items = [...(this.data.agendaItems ?? [])]
      .filter((item) => toMillis(item.startDate) > 0)
      .sort((a, b) => toMillis(a.startDate) - toMillis(b.startDate));
    return items.map((item) => ({
      title: this.rowTitle(item),
      time: new Date(toMillis(item.startDate)).toLocaleString(undefined, {
        weekday: 'short', hour: 'numeric', minute: '2-digit'
      })
    }));
  }

  private rowTitle(item: AgendaItem): string {
    return item.isCourse ? `Breakout: ${itemTitle(item)}` : (item.text || item.name || '(untitled)');
  }

  hasAppContent(): boolean {
    return !!(this.data.checkinInstructions || this.data.diningOptions ||
      this.data.whatsNext || (this.data.faqList ?? []).length || (this.data.agendaItems ?? []).length);
  }
}
