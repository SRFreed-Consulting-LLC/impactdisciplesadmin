import { Injectable } from "@angular/core";
import { LogMessage } from "../../models/utils/log-message.model";
import { FirebaseDAO } from '../../dao/firebase.dao';
import { Timestamp } from "firebase/firestore";
import { dateFromTimestamp } from "src/app/common/utils/date-from-timestamp";
import { BaseService } from "./base.service";
import { Observable, from, map, of } from "rxjs";

@Injectable({
  providedIn: "root",
})
export class LoggerService extends BaseService<LogMessage> {
  constructor(public override dao: FirebaseDAO<LogMessage>) {
    super(dao)
    this.table="log-messages"
    this.fromFirestore = LoggerService.fromFirestore
  }

  static readonly fromFirestore = (data): LogMessage => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  logMessage(type: string, created_by: string, message: string, data?: any): Observable<any> {
    try {
      let ec = this.generateErrorCode();
      let logMessage: LogMessage = { ...new LogMessage(type, created_by, message, ec, data) };
      logMessage.id = this.generateErrorCode();

      return from(this.add(logMessage)).pipe(
        map(() => {
          return ec;
        })
      );
    } catch (err) {
      console.error(err);

      return of(true);
    }
  }

  private generateErrorCode() {
    return 'xxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
