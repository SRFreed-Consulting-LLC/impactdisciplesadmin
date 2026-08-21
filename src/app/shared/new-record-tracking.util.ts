import { BaseModel } from '@impact-common/shared/models/base.model';
import { BaseService } from '../common/services/data/base.service';

export interface NewRecordTrackable extends BaseModel {
  newRecordStatus?: 'new' | 'seen';
}

// Drives the "new record" row highlight + mark-as-seen behavior shared by
// every list screen the new-record-alerts bell can link to (the 4 Requests
// Manager tables, Purchases, Event Attendees). One instance per component,
// fed via a tap() in that screen's existing
// combineLatest([service.streamAll(), filters$]) pipe:
//
//   private tracker = new NewRecordTracker(this.service);
//   ...
//   this.items$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
//     tap(([items]) => this.tracker.capture(items)),
//     map(([items, filters]) => ...)
//   );
//
// and in the template: [class.row--new]="tracker.newIds.has(item.id)"
//
// "Seen" is shared across all admins (viewing it clears it for everyone) -
// capture() marks every currently-new row seen in Firestore the moment this
// screen's data first loads. newIds itself is captured once and never
// updated again, so those rows stay visually highlighted for the rest of
// this page view even though their Firestore status has already flipped
// underneath - re-deriving newIds from later emissions would make the
// highlight disappear the instant the mark-as-seen write round-trips back
// through the same streamAll() listener.
export class NewRecordTracker<T extends NewRecordTrackable> {
  readonly newIds = new Set<string>();
  private captured = false;

  constructor(private service: BaseService<T>) {}

  capture(items: T[]): void {
    if (this.captured) {
      return;
    }
    this.captured = true;

    const newItems = items.filter((item) => item.newRecordStatus === 'new' && !!item.id);
    newItems.forEach((item) => this.newIds.add(item.id!));

    newItems.forEach((item) => {
      // Full setDoc under the hood (no merge) - see FirebaseDAO.update() -
      // so the write has to carry the whole item, not just the changed field.
      this.service.update(item.id!, { ...item, newRecordStatus: 'seen' }).catch((err) => {
        console.error(`NewRecordTracker: failed to mark record '${item.id}' seen:`, err);
      });
    });
  }
}
