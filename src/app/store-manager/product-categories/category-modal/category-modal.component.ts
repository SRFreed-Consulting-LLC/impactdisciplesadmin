import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Actions, ofActionDispatched } from '@ngxs/store';
import { ShowCategoryModal } from './category-modal.actions';
import { BehaviorSubject, Subject, takeUntil } from 'rxjs';
import { DxFormComponent } from 'devextreme-angular';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { ProductCategoriesService } from 'impactdisciplescommon/src/services/data/product-categories.service';
import notify from 'devextreme/ui/notify';

@Component({
    selector: 'app-category-modal',
    templateUrl: './category-modal.component.html',
    styleUrls: ['./category-modal.component.css'],
    standalone: false
})
export class CategoryModalComponent implements OnInit, OnDestroy {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  public category: TagModel = {};

  public inProgress$ = new BehaviorSubject<boolean>(false);
  public isVisible$ = new BehaviorSubject<boolean>(false);

  private ngUnsubscribe = new Subject<void>();

  constructor(private actions$: Actions, private service: ProductCategoriesService) {}

  ngOnInit(): void {
    this.actions$.pipe(ofActionDispatched(ShowCategoryModal), takeUntil(this.ngUnsubscribe)).subscribe(({ category }) => {
      if(category) {
        this.category = category;
      }
      this.isVisible$.next(true)
    })
  }

  onSave(item: TagModel) {
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


  onCancel() {
    this.category = {};
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  ngOnDestroy() {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
