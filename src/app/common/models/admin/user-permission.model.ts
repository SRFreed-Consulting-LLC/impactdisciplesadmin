import { IMPACT_APPLICATIONS } from '../../lists/impact_applications.enum';
import { BaseModel } from '@impact-common/shared/models/base.model';

export class UserPermission extends BaseModel {
  owner: string;
  application: IMPACT_APPLICATIONS;
  isEnabled = false;
  role: string[] = [];
}
