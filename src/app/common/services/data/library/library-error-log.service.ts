import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { LoggerService } from 'src/app/common/services/data/logger.service';

/**
 * Fire-and-forget error logging for Library-section screens - the target
 * side of the consolidation plan's "Decided - logging" cutover: the source
 * app's own errorLogs collection + Events... no, ErrorLogService (a
 * separate Library-specific error-log viewer) is NOT being ported;
 * instead, every catch site that used to call the source's
 * `ErrorLogService.logError(location, error)` now calls this, which writes
 * into this app's own existing `log-messages` collection via LoggerService
 * - no historical data migration, just a clean cutover to logging there
 * going forward. Same 'LIBRARY' type + email-or-'unknown' actor-identity
 * convention already established by
 * `library-unsaved-changes.guard.ts`'s own inline LoggerService call - this
 * just makes that pattern reusable instead of re-inlined at every site.
 */
@Injectable({ providedIn: 'root' })
export class LibraryErrorLogService {
  constructor(
    private logger: LoggerService,
    private authService: AdminAuthService,
  ) {}

  async logError(location: string, error: unknown): Promise<void> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    this.logger
      .logMessage(
        'LIBRARY',
        user?.email ?? 'unknown',
        `${location} failed: ${error}`,
        [{ error: String(error) }],
      )
      .subscribe();
  }
}
