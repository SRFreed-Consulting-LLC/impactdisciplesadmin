import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Form } from '../../common/models/editor/form.model';
import { FormService } from '../../common/services/forms.service';

@Component({
    selector: 'app-form-viewer',
    templateUrl: './form-viewer.component.html',
    standalone: false
})
export class FormViewerComponent implements OnInit {
  loading: Promise<any> = new Promise((resolve) => resolve(false));

  breadCrumbItems: Array<{}>;

  mode: string = 'edit';

  currentForm: Form;

  constructor(private route: ActivatedRoute,
    public  formService: FormService) { }

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin'}, { label: 'Form Administration', path: '/forms/form-administration' }];
    this.mode=this.route.snapshot.paramMap.get('view') == null? 'display': this.route.snapshot.paramMap.get('view');

    if(this.currentForm == null){
      this.initData(this.route.snapshot.paramMap.get('id')).then(form => {
        if(form != null){
          this.currentForm = form;
          this.currentForm.dbId = this.route.snapshot.paramMap.get('id');

          this.breadCrumbItems.push({ label: 'View ' + this.currentForm.name, active: true })

          return form;
        }
        return null;
      }).catch((error) => {
        console.error('Error in Agent Admin.', error);
      });
    }

    this.loading = new Promise((resolve) => resolve(true));
  }

  initData(id: string) {
    return new Promise<Form>((resolve, reject) => {
      this.formService.getById(id).then(form => {
        resolve(form);
      },err => console.error('Error in Form Viewer Admin', err));
    });
  }

}
