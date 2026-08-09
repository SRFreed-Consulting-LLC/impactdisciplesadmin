import { AppUser } from "src/app/common/models/admin/appuser.model";
import { EventRegistrationModel } from "src/app/common/models/domain/event-registration.model";
import { CustomerModel } from "src/app/common/models/domain/utils/customer.model";

export class UserAuthenticated {
  static readonly type = '[AUTHENTICATION] User Authenticated';
  constructor(public user: AppUser | CustomerModel | EventRegistrationModel){}
}
