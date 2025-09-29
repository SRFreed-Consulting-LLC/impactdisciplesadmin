import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { environment } from 'src/environments/environment';
import { AdminManagerModule } from './admin-manager/admin-manager.module';
import { ImpactDisciplesCommonModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { EventsManagerModule } from './events-manager/events-manager.module';
import { CoreModule } from './core/core.module';
import { CookieService } from 'ngx-cookie-service';
import { RequestsManagerModule } from './requests-manager/requests-manager.module';
import { SubscriptionsManagerModule } from './subscriptions-manager/subscriptions-manager.module';
import { WebManagerModule } from './web-manager/web-manager.module';
import { NgxsModule } from '@ngxs/store';
import { SharedModule } from './shared/shared.module';
import { StoreManagerModule } from './store-manager/store-manager.module';
import { PageManagerModule } from './page-manager/page-manager.module';
import { ImpactAdminFormsModule } from 'impactdisciplescommon/src/forms/admin/admin-forms.module';

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    NgxsModule.forRoot([], { developmentMode: !environment.production }),
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    provideFirestore(() => getFirestore()),
    AdminManagerModule,
    RequestsManagerModule,
    StoreManagerModule,
    SubscriptionsManagerModule,
    WebManagerModule,
    CoreModule,
    EventsManagerModule,
    PageManagerModule,
    ImpactDisciplesCommonModule,
    ImpactAdminFormsModule,
    SharedModule

  ],
  providers: [
    CookieService
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
