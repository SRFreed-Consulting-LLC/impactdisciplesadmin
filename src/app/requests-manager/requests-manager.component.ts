import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SectionTab } from '../shared/section-tabs/section-tabs.component';

// Maps the new-record-alerts bell's ?tab= query param (a stable slug, safe
// to hardcode in a route) to this component's own tab `template` strings
// (display text, used as the tab identity today - not worth changing just
// for this).
const TAB_SLUGS: Record<string, string> = {
  'consultation-requests': 'Consultation Requests',
  'consultation-surveys': 'Consultation Surveys',
  'lunch-and-learns': 'Lunch and Learn Requests',
  seminars: 'Seminar Requests'
};

@Component({
    selector: 'app-requests-manager',
    templateUrl: './requests-manager.component.html',
    styleUrls: ['./requests-manager.component.css'],
    standalone: false
})
export class RequestsManagerComponent implements OnInit {
  selectedTab = 'Consultation Requests';

  tabs: SectionTab[] = [
    { text: 'Consultation Requests', template: 'Consultation Requests' },
    { text: 'Consultation Surveys', template: 'Consultation Surveys' },
    { text: 'Lunch and Learn Requests', template: 'Lunch and Learn Requests' },
    { text: 'Seminar Requests', template: 'Seminar Requests' }
  ];

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.queryParamMap.get('tab');
    const tab = slug ? TAB_SLUGS[slug] : undefined;
    if (tab) {
      this.selectedTab = tab;
    }
  }

  selectTab(template: string) {
    this.selectedTab = template;
  }
}
