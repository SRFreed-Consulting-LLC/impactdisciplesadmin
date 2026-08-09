import { Injectable } from '@angular/core';
import { FirebaseDAO } from '../../dao/firebase.dao';
import { UserPermission } from '../../models/admin/user-permission.model';
import { IMPACT_APPLICATIONS } from '../../lists/impact_applications.enum';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class UserPermissionService extends BaseService<UserPermission> {
  constructor(public override dao: FirebaseDAO<UserPermission>) {
    super(dao)
    this.table="user_permissions"
  }

  isUserPermittedinCRM(): Promise<boolean>{
    return this.getAll().then(permissions => {
      let p = permissions.filter(permission => permission.application == IMPACT_APPLICATIONS.CRM_APP)

      if(p.length == 1 && p[0].isEnabled){
        return true;
      } else {
        return false;
      }
    })
  }

  isUserPermittedinAdminApp(): Promise<boolean>{
    return this.getAll().then(permissions => {
      let p = permissions.filter(permission => permission.application == IMPACT_APPLICATIONS.ADMIN_APP)

      if(p.length == 1 && p[0].isEnabled){
        return true;
      } else {
        return false;
      }
    })
  }


}
