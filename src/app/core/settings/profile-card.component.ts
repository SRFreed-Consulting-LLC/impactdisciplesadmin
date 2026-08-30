import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';

// "MY PROFILE" on the Settings screen - the one place a member of staff can
// change something about their OWN admin_users record (2026-08-29, owner's
// call: "a user should be able to save to their own accounts").
//
// Deliberately only the two name fields. Email and role are shown because
// they are the two things people want to confirm about their own account,
// and locked because they are not preferences: `email` is the key the whole
// app resolves an AdminUser by (fireauth.dao.ts looks the record up by it at
// sign-in), and `role` is propagated into the Firebase custom claim by
// onAdminUserRoleSync - editing it here would be self-escalation. Both are
// refused by firestore.rules as well, so this is a UI courtesy, not the
// enforcement; see the admin_users self-preferences carve-out.
@Component({
    selector: 'app-profile-card',
    templateUrl: './profile-card.component.html',
    styleUrls: ['./profile-card.component.scss'],
    standalone: false
})
export class ProfileCardComponent implements OnInit, OnDestroy {
  firstName = '';
  lastName = '';

  saving = false;
  saved = false;
  error: string | null = null;

  private user: AdminUser | null = null;
  private ngUnsubscribe = new Subject<void>();

  constructor(
    private authService: AdminAuthService,
    private adminUserService: AdminUserService
  ) {}

  ngOnInit(): void {
    // Same live source the shell uses - re-derived from Firebase's own auth
    // state, not the forgeable "impact-disciples-user" cookie.
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.user = user ?? null;
      this.firstName = user?.firstName ?? '';
      this.lastName = user?.lastName ?? '';
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  get email(): string {
    return this.user?.email ?? '';
  }

  get role(): string {
    return this.user?.role ?? '';
  }

  get dirty(): boolean {
    return !!this.user
      && (this.firstName.trim() !== (this.user.firstName ?? '')
        || this.lastName.trim() !== (this.user.lastName ?? ''));
  }

  // A blank first name would leave the top bar falling back to the raw email
  // address, which reads as an account that has lost its profile.
  get canSave(): boolean {
    return this.dirty && !this.saving && this.firstName.trim().length > 0;
  }

  onEdited(): void {
    // Any keystroke retires the last outcome - a "Saved" ticking away next
    // to text that no longer matches what was saved is worse than nothing.
    this.saved = false;
    this.error = null;
  }

  save(): void {
    if (!this.canSave || !this.user?.id) {
      return;
    }

    const firstName = this.firstName.trim();
    const lastName = this.lastName.trim();

    this.saving = true;
    this.saved = false;
    this.error = null;

    // PARTIAL write - two keys, nothing else. A whole-record write here
    // would carry this component's cached copy of every preference back to
    // Firestore and clobber whatever the nav or the theme picker had
    // written since login, and firestore.rules would reject it outright:
    // the self-preferences carve-out is a hasOnly() allow-list, so a write
    // listing every field as changed is denied for anyone but Admin/Root.
    this.adminUserService.updateFields(this.user.id, { firstName, lastName })
      .then(() => {
        this.user = { ...(this.user as AdminUser), firstName, lastName };
        // Push the new name into the shared copy so the shell's top-bar
        // greeting updates without a reload. ONLY the two name fields, on
        // top of whatever that copy already holds - currentAgent$ is fed
        // once per auth-state change and is stale with respect to any
        // preference written since, so replacing it wholesale would revert
        // the drawer width or the theme.
        const agent = this.authService.dao.currentAgent$.value;
        if (agent) {
          this.authService.dao.currentAgent$.next({ ...agent, firstName, lastName });
        }
        this.saving = false;
        this.saved = true;
      })
      .catch((err) => {
        console.error('Failed to save profile:', err);
        this.saving = false;
        // Said out loud rather than only logged: the write CAN legitimately
        // be refused (rules), and a silent revert is the thing that makes
        // people think the app is broken.
        this.error = 'Could not save your profile. Please try again.';
      });
  }

  revert(): void {
    this.firstName = this.user?.firstName ?? '';
    this.lastName = this.user?.lastName ?? '';
    this.onEdited();
  }
}
