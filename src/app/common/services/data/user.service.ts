import { Injectable } from '@angular/core';
import { AppUser } from '../../models/admin/appuser.model';
import { FirebaseDAO } from '../../dao/firebase.dao';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class AppUserService extends BaseService<AppUser>{
  constructor(public override dao: FirebaseDAO<AppUser>) {
    super(dao)
    this.table="users"
  }
}
