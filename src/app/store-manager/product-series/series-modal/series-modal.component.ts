import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Actions, ofActionDispatched } from '@ngxs/store';
import { DxFormComponent } from 'devextreme-angular';
import { SeriesModel } from 'impactdisciplescommon/src/models/utils/series.model';
import { SeriesService } from 'impactdisciplescommon/src/services/data/series.service';
import { BehaviorSubject, Subject, takeUntil } from 'rxjs';
import { ShowSeriesModal } from './series-modal.actions';
import notify from 'devextreme/ui/notify';

@Component({
    selector: 'app-series-modal',
    templateUrl: './series-modal.component.html',
    styleUrls: ['./series-modal.component.css'],
    standalone: false
})
export class SeriesModalComponent implements OnInit, OnDestroy {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  public series: SeriesModel = {};

  public inProgress$ = new BehaviorSubject<boolean>(false);
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);

  private ngUnsubscribe = new Subject<void>();

  constructor(private actions$: Actions, private service: SeriesService) {}

  ngOnInit(): void {
    this.actions$.pipe(ofActionDispatched(ShowSeriesModal), takeUntil(this.ngUnsubscribe)).subscribe(({ series }) => {
      if(series) {
        this.series = series;
      }
      this.isVisible$.next(true)
    })
  }

  onSave(item: SeriesModel) {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);

      if(item.id) {
        this.service.update(item.id, item).then((item) => {
          if(item) {
            notify({
              message: 'Category Updated',
              position: 'top',
              width: 600,
              type: 'success'
            });
            this.onCancel();
          } else {
            this.inProgress$.next(false);
            notify({
              message: 'Some Error Occured',
              position: 'top',
              width: 600,
              type: 'success'
            });
          }
        })
      } else {
        this.service.add(item).then((item) => {
          if(item) {
            notify({
              message: 'Category Added',
              position: 'top',
              width: 600,
              type: 'success'
            });
            this.onCancel();
          } else {
            this.inProgress$.next(false);
            notify({
              message: 'Some Error Occured',
              position: 'top',
              width: 600,
              type: 'error'
            });
          }
        })
      }
    }
  }

  showSingleImageModal = () => {
    this.isSingleImageVisible$.next(true);
  }

  closeSingleImageModal = () => {
    this.isSingleImageVisible$.next(false);
  }


  onCancel() {
    this.series = {};
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
