import { Component, NgZone, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { take } from 'rxjs/operators';
import { Form } from '../../common/models/editor/form.model';
import { FormService } from '../../common/services/forms.service';

@Component({
    selector: 'app-form-maker',
    templateUrl: './form-maker.component.html',
    standalone: false
})
export class FormMakerComponent implements OnInit {
  loading: Promise<any> = new Promise((resolve) => resolve(false));

  breadCrumbItems: Array<{}>;

  confirmPageSaveVisible = false;

  confirmPageCancelVisible = false;

  htmlContent: string;

  currentForm: Form;

  mode: string = 'edit';

  constructor(private route: ActivatedRoute,
    public ngZone: NgZone,
    public router: Router,
    public formService: FormService) { }

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin'}, { label: 'Form Administration', path: '/forms/form-administration' }];
    this.route.params.pipe(take(1)).subscribe(queryParams => {
      if(queryParams['id'] != null){
        this.formService.getById(queryParams['id']).then(p => {
            this.currentForm = p;
            this.currentForm.dbId = queryParams['id'];
            this.mode = 'edit';

            this.breadCrumbItems.push({ label: 'Edit ' + this.currentForm.name, active: true })
        } ,err => console.error('Error in Form Maker Admin', err));
      } else {
        this.mode = 'edit';

        this.breadCrumbItems.push({ label: 'Create New Form', active: true })

        this.currentForm = { ...new Form()};

      }

      this.loading = new Promise((resolve) => resolve(true));
    },err => console.error('Error in Form Maker Admin', err));
  }

  returnToFormAdministrator(){
    this.ngZone.run(() => {
      this.router.navigate(['/forms/form-administration']);
    });
  }

  showSavePopup(){
    this.confirmPageSaveVisible = true;
  }

  showCancelPopup(){
    this.confirmPageCancelVisible = true;
  }

  saveChanges(){
    this.formService.update(this.currentForm.dbId, this.currentForm);
    this.returnToFormAdministrator();

    this.closeSaveChanges();
  }

  closeSaveChanges(){
    this.confirmPageSaveVisible = false;
  }

  cancelChanges(){
    this.closeCancelChanges();
    this.returnToFormAdministrator();
  }

  closeCancelChanges(){
    this.confirmPageCancelVisible = false;
  }

  preview(){
    if(this.mode == "edit"){
      this.mode = 'preview'
    } else if(this.mode == 'preview'){
      this.mode = 'edit';
    }
  }
}
