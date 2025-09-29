import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DxButtonTypes } from 'devextreme-angular/ui/button';
import { Role } from 'impactdisciplescommon/src/lists/roles.enum';
import { SecureMenuItem } from 'impactdisciplescommon/src/models/utils/secure-menu-item.model';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { TopNavService } from 'impactdisciplescommon/src/services/utils/top-nav.service';

@Component({
  selector: 'app-main-screen',
  templateUrl: './main-screen.component.html',
  styleUrls: ['./main-screen.component.scss']
})
export class MainScreenComponent implements OnInit {
  navigation: SecureMenuItem[] = [
    { id: 0, text: "HOME", icon: "home", path:"home", users:[Role.ADMIN] },
    { id: 1, text: "ADMIN MANAGER", icon: "user", path: "admin-manager", users:[Role.ADMIN] },
    { id: 2, text: "EVENTS MANAGER", icon: "event", path: "events-manager", users:[Role.ADMIN, Role.EMPLOYEE] },
    { id: 3, text: "REQUESTS MANAGER", icon: "belloutline", path: "requests-manager", users:[Role.ADMIN] },
    { id: 4, text: "STORE MANAGER", icon: "user", path: "store-manager", users:[Role.ADMIN, Role.EMPLOYEE] },
    { id: 5, text: "SUBSCRIPTIONS MANAGER", icon: "message", path: "subscriptions-manager", users:[Role.ADMIN] },
    { id: 6, text: "WEB MANAGER", icon: "toolbox", path: "web-manager", users:[Role.ADMIN] }
  ]

  secureNav: SecureMenuItem[] = [];

  isDrawerOpen: boolean = false;
  buttonOptions: any = {
      icon: "menu",
      onClick: () => {
          this.isDrawerOpen = !this.isDrawerOpen;
      }
  }

  logOffButtonOptions: DxButtonTypes.Properties = {
    text: 'Log Off',
    onClick: () => {
      this.authService.logOut()
    },
  };

  constructor(public topNavService: TopNavService, private authService: AdminAuthService, private router: Router){}

  ngOnInit(): void {
    let userRole = this.authService.getLoggedInUser().role;

    this.secureNav = this.navigation.filter(item => item.users.find(role => role == userRole));
  }

  tabClicked(e :any){
    this.topNavService.navigate(e.itemData)
  }

  menuItemClicked(e){
    this.router.navigate(['/', e.itemData.path]);
  }
}
