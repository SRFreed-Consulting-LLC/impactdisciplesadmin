import { Injectable } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';

// Backs the top-bar "new record" alert bell. Reads the single aggregate doc
// (meta/newRecordCounts) that functions/src/new-record-alerts.functions.ts
// keeps up to date via Firestore onCreate/onUpdate triggers on the 6 source
// collections - one small doc, one listener, instead of a live listener per
// collection (see the comment on FirebaseDAO's retryDelay() for why this
// app is trying to keep the standing-listener count down).
export interface NewRecordCounts {
  eventRegistrations: number;
  consultationRequests: number;
  consultationSurveys: number;
  lunchAndLearns: number;
  seminars: number;
  purchases: number;
}

const EMPTY_COUNTS: NewRecordCounts = {
  eventRegistrations: 0,
  consultationRequests: 0,
  consultationSurveys: 0,
  lunchAndLearns: 0,
  seminars: 0,
  purchases: 0
};

@Injectable({
  providedIn: 'root'
})
export class NewRecordAlertsService {
  // Not collection-shaped, so this doesn't go through FirebaseDAO/
  // BaseService (both built around a whole collection) - a direct doc
  // subscription is simpler here.
  counts$: Observable<NewRecordCounts>;

  constructor(private fs: Firestore) {
    this.counts$ = docData(doc(this.fs, 'meta/newRecordCounts')).pipe(
      map((data) => ({ ...EMPTY_COUNTS, ...(data as Partial<NewRecordCounts> | undefined) }))
    );
  }
}
