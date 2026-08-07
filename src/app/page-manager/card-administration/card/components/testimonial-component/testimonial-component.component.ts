import { Component, Input, OnInit } from '@angular/core';
import { CardComponent, TestimonialItem } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-testimonial-component',
    templateUrl: './testimonial-component.component.html',
    standalone: false
})
export class TestimonialComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  card_backup: CardComponent = {... new CardComponent()};

  dataSource: TestimonialItem[] = [];

  editedTestimonial: any = {};

  viewConfig = false;

  imageSelectVisible = false;

  isEditing = false;

  editedField: string;

  editedPage: CardComponent;



  constructor() {
    this.onReorder = this.onReorder.bind(this);
  }

  ngOnInit(): void {
    this.dataSource = this.component.testimonial.items;
    this.card_backup = Object.assign(this.card_backup, this.component);
  }

  showPopup(){
    this.card_backup = Object.assign(this.card_backup, this.component);
    this.viewConfig = true;
  }

  displayImageSelection(fieldname: string, e?){
    if(e.row){
      this.isEditing = true;
      this.editedTestimonial = e.row.data;
    } else {
      this.isEditing = false;
      this.editedTestimonial = {...new TestimonialItem()}
    }
    this.editedField = fieldname;
    this.imageSelectVisible = true;
  }

  closeItemWindow(event){
    //if the edited image has a name and we are not editing a record then push
    if(this.editedTestimonial.item_name !="" && this.isEditing == false) {
      this.component.testimonial.items.push(this.editedTestimonial);
    }
    this.imageSelectVisible = event;
  }

  resetForm(){
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  onReorder(e) {
    var visibleRows = e.component.getVisibleRows(),
        toIndex = this.component.testimonial.items.indexOf(visibleRows[e.toIndex].data),
        fromIndex = this.component.testimonial.items.indexOf(e.itemData);
    this.component.testimonial.items.splice(fromIndex, 1);
    this.component.testimonial.items.splice(toIndex, 0, e.itemData);
  }

  getScreenHeight(): number{
    return window.innerHeight*.6;
  }
}
