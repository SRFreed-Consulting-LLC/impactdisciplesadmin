import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { getFirestore, provideFirestore, connectFirestoreEmulator } from '@angular/fire/firestore';
import { getAuth, provideAuth, connectAuthEmulator } from '@angular/fire/auth';
import { getFunctions, provideFunctions, connectFunctionsEmulator } from '@angular/fire/functions';
import { getStorage, provideStorage, connectStorageEmulator } from '@angular/fire/storage';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { environment } from 'src/environments/environment';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { CoreModule } from './core/core.module';
import { CookieService } from 'ngx-cookie-service';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './core/auth/auth.module';

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    // admin-manager, contacts-manager, events-manager, page-manager,
    // store-manager, tools-manager and reports-manager are lazy-loaded via
    // app-routing.module.ts's loadChildren - they must NOT be imported here
    // eagerly, or the bundler would pull them back into the main chunk.
    CoreModule,
    ImpactDisciplesCommonModule,
    AuthModule,
    SharedModule

  ],
  providers: [
    // App-wide form-field defaults for the navy redesign: every one of the
    // app's mat-form-fields is outline-appearance already (this just makes
    // the default explicit), and subscriptSizing: 'dynamic' drops the
    // always-reserved error/hint gap under each field - compact forms, with
    // the trade-off that a validation message appearing shifts layout.
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic' } },
    CookieService,
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    // Each provide* factory below connects its SDK to the local Emulator
    // Suite when built with the `emulator` configuration (see
    // environment-emulator.ts) - ports match firebase.json's emulators
    // block. connect*Emulator must run before the SDK's first real call,
    // which is why it lives inside the factory rather than in a component.
    provideFirestore(() => {
      const firestore = getFirestore();
      if (environment.useEmulators) {
        connectFirestoreEmulator(firestore, 'localhost', 8080);
      }
      return firestore;
    }),
    // FireAuthDao used to call firebase/auth's own getAuth() directly - that
    // bypasses AngularFire's injection-context wrapping entirely, which is
    // exactly what triggers "Calling Firebase APIs outside of an Injection
    // context" (auth state callbacks then fire outside Angular's zone,
    // risking silent change-detection misses). Providing Auth here the same
    // way Firestore already is lets FireAuthDao inject it instead.
    provideAuth(() => {
      const auth = getAuth();
      if (environment.useEmulators) {
        connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      }
      return auth;
    }),
    // Same fix, same reason, for the call site that uses a Cloud Functions
    // callable directly (AdminUserService.createAdminUser) instead of
    // getFunctions().
    provideFunctions(() => {
      const functions = getFunctions();
      if (environment.useEmulators) {
        connectFunctionsEmulator(functions, 'localhost', 5001);
      }
      return functions;
    }),
    // Needed for the Library section's AI Book Import - uploads a PDF to a
    // temporary Storage object for importBookFromPdf to read server-side.
    // See storage.rules for the scoped book-imports/{uid}/ upload rule.
    provideStorage(() => {
      const storage = getStorage();
      if (environment.useEmulators) {
        connectStorageEmulator(storage, 'localhost', 9199);
      }
      return storage;
    }),
    // Function-based provider, not the BrowserAnimationsModule NgModule form -
    // see the NG05100 fix history for why a root-only NgModule that re-exports
    // BrowserModule internally is exactly the bug class to avoid here.
    provideAnimations()
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
