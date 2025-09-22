import { Component, NgZone, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { take } from 'rxjs/operators';
import { FormService } from '../../common/services/forms.service';
import { PageService } from '../../common/services/page.service';
import { Form } from '../../common/models/editor/form.model';

@Component({
  selector: 'app-form-results',
  templateUrl: './form-results.component.html'
})
export class FormResultsComponent implements OnInit {
  breadCrumbItems: Array<{}>;

  dataSource: {}[] = [];

  displayCols: string[] = [];

  currentForm: Form;

  resultVisible = false;

  constructor(public formService: FormService,
    public pageService: PageService,
    public ngZone: NgZone,
    public router: Router,
    private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin' }, { label: 'Form Administration',  path: '/forms/form-administration' }];
    this.route.params.pipe(take(1)).subscribe(queryParams => {
      if(queryParams['id'] != null){
        this.formService.getById(queryParams['id']).then(form => {
          this.currentForm = form;

          this.breadCrumbItems.push({ label: this.currentForm.name, active: true });

          let columns: any[] = [];

          this.formService.getById(queryParams['id']).then(form => {
            form.rows.forEach(row => {
              row.inputs.forEach(input => {
                if(input.boolean.field_name){
                  columns.push({name: input.boolean.field_name, order: input.result_order});
                } else if (input.date.field_name){
                  columns.push({name: input.date.field_name, order: input.result_order});
                } else if (input.dateTime.field_name){
                  columns.push({name: input.dateTime.field_name, order: input.result_order});
                } else if (input.multipleCheckbox.field_name){
                  columns.push({name: input.multipleCheckbox.field_name, order: input.result_order});
                } else if (input.number.field_name){
                  columns.push({name: input.number.field_name, order: input.result_order});
                } else if (input.radioButtons.field_name){
                  columns.push({name: input.radioButtons.field_name, order: input.result_order});
                } else if (input.select.field_name){
                  columns.push({name: input.select.field_name, order: input.result_order});
                } else if (input.singleCheckbox.field_name){
                  columns.push({name: input.singleCheckbox.field_name, order: input.result_order});
                } else if (input.text.field_name){
                  columns.push({name: input.text.field_name, order: input.result_order});
                } else if (input.textarea.field_name){
                  columns.push({name: input.textarea.field_name, order: input.result_order});
                }
              })
            })
            columns.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

            this.displayCols.push('submitted_by_display_name');
            this.displayCols.push('submitted_by_email');
            this.displayCols.push('submitted_date');

            columns.forEach(col => this.displayCols.push(col.name));
          })

          this.formService.getFormResults(queryParams['id']). then(res => {
            if(res[0] != null){
              res.forEach(d => this.dataSource.push(d));
            }
          },err => console.error('Error in Form Results Admin', err))
        },err => console.error('Error in Form Results Admin', err))
      }
    },err => console.error('Error in Form Results Admin', err));
  }

  displayResult(e: any){
    this.currentForm = e.row.data;
    this.resultVisible = true;
  }

  closeResults(){
    this.resultVisible = false;
  }

  getScreenHeight(): number{
    return window.innerHeight*.7;
  }

}
