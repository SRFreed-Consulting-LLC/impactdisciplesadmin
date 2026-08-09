import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
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
  constructor(public override dao: FirebaseDAO<AdminUser>, private auth: Auth, private functions: Functions) {
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
  // dependency; sendPasswordResetEmail is called directly instead, using the
  // injected Auth (@angular/fire/auth's provideAuth(), see app.module.ts) -
  // not a raw getAuth() call, which bypasses AngularFire's injection-context
  // wrapping and triggers its "Calling Firebase APIs outside of an
  // Injection context" warning (same fix as FireAuthDao's own Auth). Same
  // reasoning for injecting Functions instead of calling getFunctions().
  async createAdminUser(data: CreateAdminUserData): Promise<string> {
    const fn = httpsCallable<CreateAdminUserData, { uid: string; docId: string }>(this.functions, 'createAdminUser');
    const result = await fn(data);

    await sendPasswordResetEmail(this.auth, data.email);

    return result.data.docId;
  }

  // Deletes both the admin_users profile and the underlying Firebase Auth
  // account together via the deleteAdminUser Cloud Function, so the two
  // never drift out of sync.
  async deleteAdminUser(docId: string): Promise<void> {
    const fn = httpsCallable<{ docId: string }, { docId: string }>(this.functions, 'deleteAdminUser');
    await fn({ docId });
  }
}
