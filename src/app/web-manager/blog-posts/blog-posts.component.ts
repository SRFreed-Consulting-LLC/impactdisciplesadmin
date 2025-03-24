import { Component, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import { DxTagBoxTypes } from 'devextreme-angular/ui/tag-box';
import ArrayStore from 'devextreme/data/array_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { BlogPostModel } from 'impactdisciplescommon/src/models/domain/blog-post.model';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { BlogPostService } from 'impactdisciplescommon/src/services/data/blog-post.service';
import { BlogTagsService } from 'impactdisciplescommon/src/services/data/blog-tags.service';
import { BehaviorSubject, map, Observable, switchMap } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import { BlogCategoriesService } from 'impactdisciplescommon/src/services/data/blog-categories.service';
import { Timestamp } from 'firebase/firestore';
import { HttpClient, HttpUrlEncodingCodec } from '@angular/common/http';
import { ImageModel } from 'impactdisciplescommon/src/models/utils/image.model';

@Component({
  selector: 'app-blog-posts',
  templateUrl: './blog-posts.component.html',
  styleUrls: ['./blog-posts.component.css']
})
export class BlogPostsComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: BlogPostModel;
  blogCategories: TagModel[] = [];
  itemType = 'Blog Post';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isCategoriesVisible$ = new BehaviorSubject<boolean>(false);
  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);
  public isMultipleImageVisible$ = new BehaviorSubject<boolean>(false);

  blogTags: TagModel[] = [];

  constructor(private service: BlogPostService,
    private blogTagService: BlogTagsService,
    private blogCategoriesService: BlogCategoriesService,
    private http: HttpClient) {}

  async ngOnInit() {
    this.datasource$ = this.service.streamAll().pipe(
      map(
        (data) =>
          new DataSource({
            reshapeOnPush: true,
            pushAggregationTimeout: 100,
            store: new ArrayStore({
              key: 'id',
              data
          })
        })
      )
    )

    this.blogTagService.streamAll().subscribe(tags => {
      this.blogTags = tags;
    });

    this.blogCategories = await this.blogCategoriesService.getAll();
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));
    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new BlogPostModel()};
    this.selectedItem.date = Timestamp.now().toDate();
    this.isVisible$.next(true);
  }

  showCategoriesModal = () => {
    this.isCategoriesVisible$.next(true);
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.service.delete(data.id).then(() => {
          notify({
            message: this.itemType + ' Deleted',
            position: 'top',
            width: 600,
            type: 'success'
          });
        })
      }
    });
  }

  onSave(item: BlogPostModel) {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);

      if(item.id) {
        this.service.update(item.id, item).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Updated',
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
              message: this.itemType + ' Added',
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

  onCategoriesCancel() {
    this.inProgress$.next(false);
    this.isCategoriesVisible$.next(false);
  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }


  onCustomItemCreating(args: DxTagBoxTypes.CustomItemCreatingEvent) {
    if(args.text){
      let blogTag: TagModel = {... new TagModel()}
      blogTag.tag = args.text;
      blogTag.id = this.generateRandomId();

      const isItemInDataSource = this.blogTags.some((item) => item.tag === blogTag.tag);

      if (!isItemInDataSource) {
        this.blogTagService.update(blogTag.id, blogTag)
      }

      args.customItem = blogTag;
    }
  }

  private generateRandomId() {
    return 'xxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  showSingleImageModal = () => {
    this.isSingleImageVisible$.next(true);
  }

  closeSingleImageModal = () => {
    this.isSingleImageVisible$.next(false);
  }

  showMultipleImageModal = () => {
    this.isMultipleImageVisible$.next(true);
  }

  closeMultipleImageModal = () => {
    this.isMultipleImageVisible$.next(false);
  }
}
