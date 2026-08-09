import { Component, HostBinding } from '@angular/core';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { ScreenService } from 'src/app/common/services/utils/screen.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    standalone: false
})
export class AppComponent {
  title = 'impactdisciplesadmin';

  @HostBinding('class') get getClass() {
    return Object.keys(this.screen.sizes).filter(cl => this.screen.sizes[cl]).join(' ');
  }

  constructor(private authService: AdminAuthService, private screen: ScreenService) { }

  isAuthenticated() {
    return this.authService.loggedIn;
  }
}
