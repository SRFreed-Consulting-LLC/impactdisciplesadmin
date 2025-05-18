import { Component, OnInit } from '@angular/core';
import { Role } from 'impactdisciplescommon/src/lists/roles.enum';
import { Tab } from 'impactdisciplescommon/src/models/utils/tab.model';
import { AuthService } from 'impactdisciplescommon/src/services/utils/auth.service';

@Component({
  selector: 'app-store-manager',
  templateUrl: './store-manager.component.html',
  styleUrls: ['./store-manager.component.css']
})
export class StoreManagerComponent implements OnInit {

  selectedIndex: number = 0;
  selectedTab: string = 'Products';

  tabs: Tab[] = [
    { id: 0, text: 'Products', template: 'Products', users:[Role.ADMIN] },
    { id: 1, text: 'Purchases', template: 'Purchases', users:[Role.ADMIN, Role.EMPLOYEE] },
    { id: 3, text: 'Coupons', template: 'Coupons', users:[Role.ADMIN] },
    { id: 4, text: 'Sales', template: 'Sales', users:[Role.ADMIN] },
  ];

  secureTabs: Tab[] = [];

  constructor(private authService: AuthService){}

  ngOnInit(): void {
    let userRole = this.authService.getLoggedInUser().role;

    this.secureTabs = this.tabs.filter(item => item.users.find(role => role == userRole));

    this.selectedTab = this.secureTabs[0].template;
  }

  selectTab(e) {
    this.selectedTab = e.itemData.template;
    this.selectedIndex = e.itemData.id;
  }
}
