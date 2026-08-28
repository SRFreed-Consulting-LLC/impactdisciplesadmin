import { Component, HostBinding } from '@angular/core';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { ScreenService } from 'src/app/common/services/utils/screen.service';
import { ThemeService } from 'src/app/common/services/utils/theme.service';

// Guards recoverFromStaleChunk() below against reload-looping - sessionStorage
// (not a plain field) so it survives the full page reload the recovery itself
// triggers, and gets cleared again on the next successful navigation so the
// mechanism is still armed for a later deploy in the same long-lived session.
const STALE_CHUNK_RELOAD_KEY = 'id-admin-stale-chunk-reload';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    standalone: false
})
export class AppComponent {
  title = 'impactdisciplesadmin';

  @HostBinding('class') get getClass() {
    return Object.keys(this.screen.sizes).filter(cl => this.screen.sizes[cl]).join(' ');
  }

  // ThemeService is injected purely to instantiate it at boot: a
  // providedIn: 'root' service isn't constructed until something injects it,
  // and before this it was only injected by the Settings screen - so an
  // admin's saved theme wasn't applied until they happened to open Settings.
  constructor(private screen: ScreenService, private router: Router, private theme: ThemeService) {
    // Every lazy feature module (admin-manager, events-manager, ...) is a
    // content-hashed chunk baked into main.js at build time - see
    // app-routing.module.ts's loadChildren calls. Firebase Hosting deploys
    // replace the whole file set atomically, so a tab left open since
    // before a newer deploy 404s the moment it tries to lazy-load a module
    // it hasn't visited yet in this session (surfaces as a router
    // NavigationError wrapping "Failed to fetch dynamically imported
    // module..." - stuck on the current screen, every nav link a no-op).
    // The standard fix for content-hashed SPA deploys is a one-time hard
    // reload to pick up the current index.html + matching chunk hashes,
    // continuing on to wherever the user was trying to go - not a retry of
    // the same (now-stale) in-memory bundle.
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
      } else if (event instanceof NavigationError && this.isStaleChunkError(event.error)) {
        this.recoverFromStaleChunk(event.url);
      }
    });
  }

  private isStaleChunkError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /dynamically imported module|chunkloaderror|loading chunk/i.test(message);
  }

  private recoverFromStaleChunk(url: string): void {
    // Already tried once without a successful navigation landing in
    // between - a real (non-deploy) module-resolution bug, not this. Let it
    // surface as a normal broken navigation instead of reloading forever.
    if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) {
      return;
    }
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, '1');
    window.location.href = url || window.location.pathname;
  }
}
