import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NAV_CONFIG } from 'src/app/core/main-screen/nav-config';

@Component({
    selector: 'app-requests-manager',
    templateUrl: './requests-manager.component.html',
    styleUrls: ['./requests-manager.component.css'],
    standalone: false
})
export class RequestsManagerComponent implements OnInit {
  selectedTab = 'Consultation Requests';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list - also where the new-record-alerts
  // bell's ?tab= slugs for this module are defined (they must match).
  tabs = NAV_CONFIG.find((g) => g.id === 'requests-manager')!.items!;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    // Live subscription, not a one-time snapshot read - the left nav lets
    // an admin click between sibling tabs while already on this route,
    // which Angular resolves as a same-route, query-param-only navigation
    // (no new component instance, so ngOnInit itself doesn't re-fire).
    this.route.queryParamMap.subscribe((params) => {
      const tab = this.tabs.find((t) => t.slug === params.get('tab'));
      this.selectedTab = tab?.label ?? this.selectedTab;
    });
  }
}
