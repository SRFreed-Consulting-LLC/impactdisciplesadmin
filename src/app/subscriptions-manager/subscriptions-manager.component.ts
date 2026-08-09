import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NAV_CONFIG } from 'src/app/core/main-screen/nav-config';

@Component({
    selector: 'app-subscriptions-manager',
    templateUrl: './subscriptions-manager.component.html',
    styleUrls: ['./subscriptions-manager.component.css'],
    standalone: false
})
export class SubscriptionsManagerComponent implements OnInit {
  selectedTab = 'Newsletters';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list.
  tabs = NAV_CONFIG.find((g) => g.id === 'subscriptions-manager')!.items!;

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
