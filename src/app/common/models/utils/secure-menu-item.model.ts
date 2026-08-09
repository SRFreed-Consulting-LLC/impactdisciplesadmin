import { Role } from "src/app/common/lists/roles.enum";

export class SecureMenuItem{
  id: number;
  text: string;
  icon: string;
  path: string;
  users: Role[]
}
