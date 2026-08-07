import { Component, Input, OnInit } from '@angular/core';
import { CardComponent, GalleryItem } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-carousel-component',
    templateUrl: './carousel-component.component.html',
    standalone: false
})
export class CarouselComponentComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  @Input('col_count') col_count: number = 0;

  card_backup: CardComponent = {... new CardComponent()};

  dataSource: GalleryItem[] = [];

  editedImage: any = {};

  viewConfig = false;

  imageSelectVisible = false;

  isEditing = false;

  editedField: string;





  constructor() {
    this.onReorder = this.onReorder.bind(this);
  }

  ngOnInit(): void {
    this.dataSource = this.component.gallery.items;
    this.card_backup = Object.assign(this.card_backup, this.component);


  }

  showPopup(){
    this.viewConfig = true;
  }

  displayImageSelection(e){
    if(e.row){
      this.isEditing = true;
      this.editedImage = e.row.data;
    } else {
      this.isEditing = false;
      this.editedImage = {...new GalleryItem()}
    }
    this.editedField = 'item_url';
    this.imageSelectVisible = true;
  }

  closeItemWindow(event){
    //if the edited image has a name and we are not editing a record then push
    if(this.editedImage.item_name !="" && this.isEditing == false) {
      this.component.gallery.items.push(this.editedImage);
    }
    this.imageSelectVisible = event;
  }

  resetForm(){
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  onReorder(e) {
    var visibleRows = e.component.getVisibleRows(),
        toIndex = this.component.gallery.items.indexOf(visibleRows[e.toIndex].data),
        fromIndex = this.component.gallery.items.indexOf(e.itemData);
    this.component.gallery.items.splice(fromIndex, 1);
    this.component.gallery.items.splice(toIndex, 0, e.itemData);
  }
  getScreenHeight(): number{
    return window.innerHeight*.7;
  }
}
