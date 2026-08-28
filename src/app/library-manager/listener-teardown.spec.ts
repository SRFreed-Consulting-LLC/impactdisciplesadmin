import { TestBed } from '@angular/core/testing';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject } from 'rxjs';

// Regression cover for the 2026-08-27 sweep's finding A1: five components
// subscribed to LIVE Firestore snapshot streams (docData/collectionData) and
// never unsubscribed.
//
// Why this file exists rather than a spec per component: the thing that
// regressed is not any component's logic, it is the PIPE. A missing
// takeUntilDestroyed is invisible - the screen works perfectly, and the only
// symptom is a listener that outlives the component, re-reading (and
// re-billing) Firestore forever to update a DOM that is gone. Nothing fails.
// The worst site was the activity log, a limit(500) collectionData behind an
// @if, so every tab switch left another 500-document listener running.
//
// What is pinned here is the MECHANISM those five now rely on, in both of the
// shapes the codebase actually uses:
//   - subscribe in the constructor (four of the five sites)
//   - subscribe in ngOnInit, which is NOT an injection context and therefore
//     needs an explicitly captured DestroyRef (e2e-dashboard)
//
// If a future Angular upgrade changes either behaviour, this fails loudly
// instead of quietly restoring the leak.

/** Stands in for a Firestore docData/collectionData: hot, never completes,
 *  and counts its live subscribers the way an onSnapshot listener would. */
class FakeSnapshotStream {
  private readonly subject = new Subject<number>();
  liveSubscribers = 0;

  asObservable(): Observable<number> {
    return new Observable<number>((observer) => {
      this.liveSubscribers++;
      const sub = this.subject.subscribe(observer);
      return () => {
        this.liveSubscribers--;
        sub.unsubscribe();
      };
    });
  }

  emit(value: number): void {
    this.subject.next(value);
  }
}

@Component({ template: '', standalone: false })
class ConstructorSubscriberComponent {
  received: number[] = [];
  private readonly destroyRef = inject(DestroyRef);

  constructor(stream: FakeSnapshotStream) {
    stream.asObservable()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.received.push(v));
  }
}

@Component({ template: '', standalone: false })
class NgOnInitSubscriberComponent implements OnInit {
  received: number[] = [];
  // Captured as a field on purpose: ngOnInit is not an injection context, so
  // takeUntilDestroyed() with no argument throws NG0203 there.
  private readonly destroyRef = inject(DestroyRef);

  constructor(private stream: FakeSnapshotStream) {}

  ngOnInit(): void {
    this.stream.asObservable()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.received.push(v));
  }
}

describe('library-manager listener teardown (sweep A1)', () => {
  let stream: FakeSnapshotStream;

  beforeEach(() => {
    stream = new FakeSnapshotStream();
    TestBed.configureTestingModule({
      declarations: [ConstructorSubscriberComponent, NgOnInitSubscriberComponent],
      providers: [{ provide: FakeSnapshotStream, useValue: stream }],
    });
  });

  it('constructor subscribe: listener detaches when the component is destroyed', () => {
    const fixture = TestBed.createComponent(ConstructorSubscriberComponent);
    fixture.detectChanges();
    expect(stream.liveSubscribers).toBe(1);

    stream.emit(1);
    expect(fixture.componentInstance.received).toEqual([1]);

    fixture.destroy();

    expect(stream.liveSubscribers)
      .withContext('the onSnapshot equivalent must be released on destroy')
      .toBe(0);
  });

  it('ngOnInit subscribe with an explicit DestroyRef also detaches', () => {
    const fixture = TestBed.createComponent(NgOnInitSubscriberComponent);
    fixture.detectChanges();
    expect(stream.liveSubscribers).toBe(1);

    fixture.destroy();
    expect(stream.liveSubscribers).toBe(0);
  });

  it('a destroyed component stops receiving - no writes to a dead DOM', () => {
    const fixture = TestBed.createComponent(ConstructorSubscriberComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    stream.emit(1);
    fixture.destroy();
    stream.emit(2);
    stream.emit(3);

    expect(component.received)
      .withContext('emissions after destroy must not reach the callback')
      .toEqual([1]);
  });

  it('mounting and destroying repeatedly leaves NOTHING behind', () => {
    // The actual failure mode: these screens sit behind an @if and are
    // re-created on every tab switch, so the leak compounded per visit.
    for (let i = 0; i < 10; i++) {
      const fixture = TestBed.createComponent(ConstructorSubscriberComponent);
      fixture.detectChanges();
      fixture.destroy();
    }
    expect(stream.liveSubscribers)
      .withContext('ten mount/destroy cycles must leave zero live listeners')
      .toBe(0);
  });

  it('WITHOUT the pipe the listener survives - proving the pipe is load-bearing', () => {
    // Guards against someone "simplifying" the pipe away: this is what the
    // five sites did before the fix, and it is silent.
    @Component({ template: '', standalone: false })
    class LeakyComponent {
      constructor(s: FakeSnapshotStream) {
        s.asObservable().subscribe();
      }
    }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      declarations: [LeakyComponent],
      providers: [{ provide: FakeSnapshotStream, useValue: stream }],
    });

    const fixture = TestBed.createComponent(LeakyComponent);
    fixture.detectChanges();
    fixture.destroy();

    expect(stream.liveSubscribers)
      .withContext('an unpiped subscribe leaks - this is the bug A1 fixed')
      .toBe(1);
  });
});
