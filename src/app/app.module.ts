import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { environment } from 'src/environments/environment';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { CoreModule } from './core/core.module';
import { CookieService } from 'ngx-cookie-service';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    // admin-manager, events-manager, requests-manager, subscriptions-manager,
    // web-manager and store-manager are lazy-loaded via app-routing.module.ts's
    // loadChildren - they must NOT be imported here eagerly, or the bundler
    // would pull them back into the main chunk.
    CoreModule,
    ImpactDisciplesCommonModule,
    AuthModule,
    SharedModule

  ],
  providers: [
    CookieService,
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    provideFirestore(() => getFirestore()),
    // Function-based provider, not the BrowserAnimationsModule NgModule form -
    // see the NG05100 fix history for why a root-only NgModule that re-exports
    // BrowserModule internally is exactly the bug class to avoid here.
    provideAnimations()
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
