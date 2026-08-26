import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { Observable, catchError, map, of } from 'rxjs';

/** One suite's last run, as scripts/publish-e2e-run.js writes it. */
export interface E2eRunAreaRollup {
  id: string;
  title: string;
  status: 'green' | 'yellow' | 'red' | 'unknown';
  passed: number;
  failed: number;
  flaky: number;
}

export interface E2eRun {
  suiteId: string;
  status: 'passed' | 'unreliable' | 'failed';
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs: number;
  /** Firestore Timestamp, a Date, or an ISO string depending on writer. */
  finishedAt?: unknown;
  areas?: E2eRunAreaRollup[];
  runner?: string;
}

// Reads the last-run record each e2e suite publishes.
//
// Deliberately NOT a BaseService subclass: `e2e_runs` is written only by the
// Admin SDK (see firestore.rules - every client write is denied), so the
// add/update/delete half of BaseService would be dead weight advertising
// operations that cannot succeed. This is read-only by construction.
//
// The catalog of what each suite COVERS is separate and static - see the
// shared submodule's shared/testing/e2e-catalog.ts. This supplies only the
// runtime half, joined by suite id.
@Injectable({ providedIn: 'root' })
export class E2eRunService {
  private readonly firestore = inject(Firestore);

  /**
   * Last run for every suite, keyed by suite id.
   *
   * Errors resolve to an EMPTY map rather than throwing: a dashboard whose
   * whole job is to report status should say "never run" for everything if
   * it cannot read, not blank the page with an error. The distinction the
   * caller cares about - "no record" vs "could not read" - is surfaced by
   * `readFailed` alongside it.
   */
  runsBySuite(): Observable<Map<string, E2eRun>> {
    return collectionData(collection(this.firestore, 'e2e_runs'), { idField: 'suiteId' })
      .pipe(
        map((docs) => {
          const bySuite = new Map<string, E2eRun>();
          for (const doc of docs as E2eRun[]) {
            bySuite.set(doc.suiteId, doc);
          }
          return bySuite;
        }),
        catchError(() => of(new Map<string, E2eRun>())),
      );
  }
}
