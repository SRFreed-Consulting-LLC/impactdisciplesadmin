import { Injectable } from "@angular/core";
import { randomHexId } from '../../utils/random-hex-id';
import { LogMessage } from "@impact-common/shared/models/utils/log-message.model";
import { FirebaseDAO } from '../../dao/firebase.dao';
import { Timestamp } from "firebase/firestore";
import { dateFromTimestamp } from "@impact-common/shared/utils/date-from-timestamp";
import { BaseService } from "./base.service";
import { Observable, catchError, from, map, of } from "rxjs";

@Injectable({
  providedIn: "root",
})
export class LoggerService extends BaseService<LogMessage> {
  constructor(public override dao: FirebaseDAO<LogMessage>) {
    super(dao)
    this.table="log-messages"
    this.fromFirestore = LoggerService.fromFirestore
  }

  static readonly fromFirestore = (data: LogMessage): LogMessage => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  // A log line is best-effort and must NEVER break its caller: it resolves
  // with the error code either way. Two things went wrong here until
  // 2026-09-04, both on the pre-auth failed-login path: it used add(),
  // which reads the new document back - a read log-messages refuses to
  // anyone but an Admin, so the line was written and the read threw - and
  // that rejection was allowed to escape, so a wrong password left the
  // login screen spinning with no message. create() writes without reading
  // back, and catchError keeps the promise the signature makes.
  logMessage(type: string, created_by: string, message: string, data?: unknown): Observable<string | boolean> {
    try {
      const ec = randomHexId(8);
      const logMessage: LogMessage = { ...new LogMessage(type, created_by, message, ec, LoggerService.sanitizeData(data)) };
      logMessage.id = randomHexId(8);

      return from(this.create(logMessage)).pipe(
        map(() => ec),
        catchError((err) => {
          console.error('Could not write a log message', err);
          return of(ec);
        })
      );
    } catch (err) {
      console.error(err);

      return of(true);
    }
  }


  // Firestore rejects custom class instances (Error, FirebaseError) and
  // undefined values inside addDoc payloads -- and several call sites pass
  // a caught error straight in as { err }. Reduce everything to plain
  // JSON-safe values so logging an error can never itself throw.
  // (Ported verbatim from the web repo's copy of this service, 2026-08-20.)
  private static sanitizeData(data: unknown): unknown {
    if (data === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(JSON.stringify(data, (_key, value) => {
        if (value instanceof Error) {
          return { name: value.name, message: value.message, stack: value.stack ?? null };
        }
        return value === undefined ? null : value;
      }));
    } catch {
      return { unserializable: String(data) };
    }
  }
}
