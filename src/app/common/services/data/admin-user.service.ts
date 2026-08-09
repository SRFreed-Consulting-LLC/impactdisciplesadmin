import { Injectable } from '@angular/core';
import { AdminUser } from '../../models/admin/admin-user.model';
import { FirebaseDAO } from '../../dao/firebase.dao';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class AdminUserService extends BaseService<AdminUser>{
  constructor(public override dao: FirebaseDAO<AdminUser>) {
    super(dao)
    this.table="admin_users"
  }
}
