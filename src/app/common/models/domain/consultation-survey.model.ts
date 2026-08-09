import { Address } from 'src/app/common/models/domain/utils/address.model';
import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";
import { Phone } from "./utils/phone.model";

export class ConsultationSurveyModel extends BaseModel{
  dateString: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: Phone;
  churchName?: string;
  location: Address;
  country?: string;
  commitment?: number;
  readiness?: number;
  strategyDescription?: string;
  teamDescription?: string;
  communicationDescription?: string;
  resourceDescription?: string;
  resultsDescription?: string;
  supportDescription?: string;
  date: Timestamp
}
