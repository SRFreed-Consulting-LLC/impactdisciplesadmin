import { Component, Input } from '@angular/core';
import { EventVenue } from '@impact-common/shared/models/domain/event.model';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { FAQModel } from '@impact-common/shared/models/utils/faq.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';

// What the HOST feeds the preview - live form values + the resolved venue,
// never a saved model (the whole point is seeing unsaved edits).
export interface SummitPreviewData {
  eventName?: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  // 'HH:mm' string - formatted locally, never Date-parsed (see
  // events.component.ts toTimeValue()'s bug note).
  checkIn?: string | null;
  description?: string | null;
  videoId?: string | null;
  imageUrl?: ImageModel | null;
  venue?: EventVenue | null;
  costInDollars?: number | null;
  // App/attendee-experience content + schedule - consumed by the preview
  // RAIL's APP view (and the web views' agenda/FAQ sections); quill HTML
  // for the three rich-text fields.
  diningOptions?: string | null;
  checkinInstructions?: string | null;
  whatsNext?: string | null;
  faqList?: FAQModel[] | null;
  agendaItems?: AgendaItem[] | null;
}

// Live approximation of the PUBLIC summit page (impactdisciples-web's
// summit.component) - hero image, dates/venue/check-in row, countdown
// tiles, register button (inert), description, promo video thumbnail.
// Hosted on every Summit Setup Wizard step and the summit Info tab, fed by
// live form values so the admin sees changes as they type - the same
// right-side-preview pattern as the popup and email designers.
@Component({
    selector: 'app-summit-preview',
    templateUrl: './summit-preview.component.html',
    styleUrls: ['./summit-preview.component.scss'],
    standalone: false
})
export class SummitPreviewComponent {
  @Input() data: SummitPreviewData = {};

  dateRange(): string {
    const start = toMillis(this.data.startDate);
    if (!start) return 'Dates not set';
    const startDate = new Date(start);
    const end = toMillis(this.data.endDate);
    const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
    const startText = startDate.toLocaleDateString(undefined, opts);
    if (!end) return `${startText}, ${startDate.getFullYear()}`;
    return `${startText} - ${new Date(end).toLocaleDateString(undefined, opts)}, ${startDate.getFullYear()}`;
  }

  checkInText(): string {
    const value = (this.data.checkIn ?? '').trim();
    if (!/^\d{2}:\d{2}$/.test(value)) return '';
    const [h, m] = value.split(':').map(Number);
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  startTimeText(): string {
    const ms = toMillis(this.data.startDate);
    return ms ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  }

  venueLine(): string {
    const venue = this.data.venue;
    if (!venue) return '';
    const a = venue.address ?? {};
    return [venue.name, [a.address1, a.city, a.state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  }

  // Recomputed per change-detection cycle - an interval isn't worth it for
  // an admin-side preview.
  countdown(): { days: number; hours: number; mins: number } | null {
    const ms = toMillis(this.data.startDate);
    if (!ms) return null;
    const diff = Math.max(0, ms - Date.now());
    return {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      mins: Math.floor((diff % 3600000) / 60000)
    };
  }

  videoThumb(): string | null {
    const id = (this.data.videoId ?? '').trim();
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
  }
}
