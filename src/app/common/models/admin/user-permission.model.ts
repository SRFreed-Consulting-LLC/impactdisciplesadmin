import { IMPACT_APPLICATIONS } from '../../lists/impact_applications.enum';
import { BaseModel } from '../base.model';

export class UserPermission extends BaseModel {
  owner: string;
  application: IMPACT_APPLICATIONS;
  isEnabled: boolean = false;
  role: string[] = [];
}
