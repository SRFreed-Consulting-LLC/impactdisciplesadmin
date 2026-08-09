import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";


export class LogMessage extends BaseModel {
    constructor(type: string, created_by: string, message: string,  error_code: string, data?: any){
      super();

      this.date = Timestamp.fromDate(new Date()) ;
      this.type = type;
      this.error_code = error_code;
      this.archived = false;
      this.message = message;
      if(data){
        this.data = data;
      }
    }

    date: Timestamp | Date;
    type: string;
    message: string;
    data: any
    error_code: string;
    archived: boolean;
  }
