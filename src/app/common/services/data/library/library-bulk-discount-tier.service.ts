import { Injectable } from '@angular/core';
import { Firestore, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { BulkDiscountTier } from '@impact-common/models/bulk-discount-tier.model';
import { LibraryActivityLogService } from './library-activity-log.service';

/**
 * Ported from impact-discipleship-library-manager-new's
 * BulkDiscountTierService. Reads/writes the `bulkDiscountTiers` collection
 * in THIS app's own default database (Phase 3 migration target). One-shot
 * reads (getTiers()), not the source app's live `collectionData` listener,
 * matching every other Library service ported so far in this app.
 *
 * Doc id is `String(numberOfBooks)` - this is what makes "numberOfBooks
 * must be unique" free (a duplicate is a same-id overwrite, not a silent
 * second row), so there's no separate uniqueness check to enforce here.
 */
@Injectable({
  providedIn: 'root',
})
export class LibraryBulkDiscountTierService {
  constructor(
    private firestore: Firestore,
    private authService: AdminAuthService,
    private activityLog: LibraryActivityLogService,
  ) {}

  private async uid(): Promise<string> {
    const user = await firstValueFrom(this.authService.dao.loggedInUser$);
    return user?.firebaseUID ?? user?.id ?? '';
  }

  async getTiers(): Promise<BulkDiscountTier[]> {
    const snap = await getDocs(
      query(collection(this.firestore, 'bulkDiscountTiers'), orderBy('numberOfBooks')),
    );
    return snap.docs.map((d) => d.data() as BulkDiscountTier);
  }

  /** Rejects if a tier for this numberOfBooks already exists - use
   *  updateTier to change an existing row's percentOff instead. */
  async createTier(numberOfBooks: number, percentOff: number): Promise<void> {
    const ref = doc(this.firestore, 'bulkDiscountTiers', String(numberOfBooks));
    if ((await getDoc(ref)).exists()) {
      throw new Error(`A discount tier for ${numberOfBooks} books already exists.`);
    }
    await setDoc(ref, { numberOfBooks, percentOff, updatedAt: Date.now(), updatedBy: await this.uid() });
    await this.activityLog.log('config_tier_created', {
      targetName: `${numberOfBooks} books`,
      detail: `${percentOff}% off`,
    });
  }

  /** numberOfBooks can't change here - the doc id is derived from it, so
   *  changing the count means deleting this row and creating a new one. */
  async updateTier(numberOfBooks: number, percentOff: number): Promise<void> {
    const ref = doc(this.firestore, 'bulkDiscountTiers', String(numberOfBooks));
    await setDoc(ref, { numberOfBooks, percentOff, updatedAt: Date.now(), updatedBy: await this.uid() });
    await this.activityLog.log('config_tier_updated', {
      targetName: `${numberOfBooks} books`,
      detail: `${percentOff}% off`,
    });
  }

  async deleteTier(numberOfBooks: number): Promise<void> {
    await deleteDoc(doc(this.firestore, 'bulkDiscountTiers', String(numberOfBooks)));
    await this.activityLog.log('config_tier_deleted', { targetName: `${numberOfBooks} books` });
  }
}
