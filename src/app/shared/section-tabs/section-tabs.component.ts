import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface SectionTab {
  text: string;
  template: string;
}

// Replaces DevExtreme's <dx-tabs> as the "which screen within this manager
// module" switcher (Logs/Notifications/Users/... in Admin Manager, and the
// equivalent bar in every other manager module) - a plain, controlled
// component so the parent keeps owning selectedTab exactly like it already
// does. Styled to match the original dx-tabs bar's appearance pixel-for-
// pixel (see section-tabs.component.scss) rather than Material's own
// mat-tab-group look (an underline indicator, different spacing/ripples),
// since this is a visual swap only - the parent's existing tabs/
// selectedTab/selectTab() wiring is unchanged.
@Component({
    selector: 'app-section-tabs',
    templateUrl: './section-tabs.component.html',
    styleUrls: ['./section-tabs.component.scss'],
    standalone: false
})
export class SectionTabsComponent {
  @Input() tabs: SectionTab[] = [];
  @Input() selectedTab: string;
  @Output() tabChange = new EventEmitter<string>();
}
