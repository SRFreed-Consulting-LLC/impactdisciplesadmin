import { firstValueFrom } from 'rxjs';
import { LoggerService } from './logger.service';
import { FirebaseDAO } from '../../dao/firebase.dao';
import { LogMessage } from '@impact-common/shared/models/utils/log-message.model';

// The failed-login log is written by an ANONYMOUS browser, and the rules
// let it create a log message but never read one. Until 2026-09-04 this
// service used add(), which reads the new document back - the line was
// written, the read was refused, the rejection escaped, and the login
// screen spun forever on a wrong password. These pin the two halves of the
// fix: no read-back, and a write failure never reaches the caller.
describe('LoggerService.logMessage', () => {
  function build(create: (value: LogMessage, table: string) => Promise<string>) {
    const dao = {
      create: jasmine.createSpy('create').and.callFake(create),
      add: jasmine.createSpy('add'),
      getById: jasmine.createSpy('getById')
    } as unknown as FirebaseDAO<LogMessage>;
    return { service: new LoggerService(dao), dao };
  }

  it('creates the line without reading it back, and resolves with the error code', async () => {
    const { service, dao } = build(() => Promise.resolve('new-id'));
    const code = await firstValueFrom(service.logMessage('LOGIN', 'k@x.test', 'wrong password', [{ code: 'auth/wrong-password' }]));
    expect(typeof code).toBe('string');
    expect((code as string).length).toBe(8);
    expect(dao.create).toHaveBeenCalledTimes(1);
    expect(dao.add).not.toHaveBeenCalled();
    expect(dao.getById).not.toHaveBeenCalled();
    // Shape the rules pin: nothing beyond these keys, or the anonymous
    // create is refused.
    const written = (dao.create as jasmine.Spy).calls.mostRecent().args[0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(['archived', 'data', 'date', 'error_code', 'id', 'message', 'type']);
  });

  it('still resolves when the write is refused - a log line must never break its caller', async () => {
    const { service } = build(() => Promise.reject(new Error('Missing or insufficient permissions.')));
    const consoleError = spyOn(console, 'error');
    const code = await firstValueFrom(service.logMessage('LOGIN', 'k@x.test', 'wrong password'));
    expect(typeof code).toBe('string');
    expect(consoleError).toHaveBeenCalled();
  });
});
