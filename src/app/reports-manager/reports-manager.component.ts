import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NAV_CONFIG } from 'src/app/core/main-screen/nav-config';

@Component({
    selector: 'app-reports-manager',
    templateUrl: './reports-manager.component.html',
    styleUrls: ['./reports-manager.component.css'],
    standalone: false
})
export class ReportsManagerComponent implements OnInit {
  selectedTab = 'Purchases';

  // Sourced from nav-config.ts (the left nav's own data) rather than a
  // second, locally-duplicated list.
  tabs = NAV_CONFIG.find((g) => g.id === 'reports-manager')!.items!;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const tab = this.tabs.find((t) => t.slug === params.get('tab'));
      this.selectedTab = tab?.label ?? this.selectedTab;
    });
  }
}
