import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { AdminUser } from '../../models/admin/admin-user.model';
import { FirebaseDAO } from '../../dao/firebase.dao';
import { BaseService } from './base.service';

export interface CreateAdminUserData {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  phone?: unknown;
  shippingAddress?: unknown;
  billingAddress?: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class AdminUserService extends BaseService<AdminUser>{
  constructor(public override dao: FirebaseDAO<AdminUser>, private fs: Firestore) {
    super(dao)
    this.table="admin_users"
  }

  // Creates the real Firebase Auth account (via the createAdminUser Cloud
  // Function - the Admin SDK is the only thing that can create an account
  // for someone other than the caller) and its matching admin_users profile
  // together, then emails the new admin a password-reset link so they can
  // set their own password. Mirrors impact-discipleship-library-manager-
  // new's UserService.createUser(). Not using AdminAuthService here - it
  // already injects AdminUserService, so the reverse would be a circular
  // dependency; sendPasswordResetEmail is called directly instead, the same
  // way FireAuthDao derives its own Auth instance (getAuth(this.fs.app)).
  async createAdminUser(data: CreateAdminUserData): Promise<string> {
    const fn = httpsCallable<CreateAdminUserData, { uid: string; docId: string }>(getFunctions(), 'createAdminUser');
    const result = await fn(data);

    await sendPasswordResetEmail(getAuth(this.fs.app), data.email);

    return result.data.docId;
  }

  // Deletes both the admin_users profile and the underlying Firebase Auth
  // account together via the deleteAdminUser Cloud Function, so the two
  // never drift out of sync.
  async deleteAdminUser(docId: string): Promise<void> {
    const fn = httpsCallable<{ docId: string }, { docId: string }>(getFunctions(), 'deleteAdminUser');
    await fn({ docId });
  }
}
