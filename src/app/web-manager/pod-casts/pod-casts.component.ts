import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { PodCastModel } from 'impactdisciplescommon/src/models/domain/pod-cast.model';
import { PodCastService } from 'impactdisciplescommon/src/services/data/pod-cast.service';
import { BehaviorSubject, map, Observable, Subject, takeUntil } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import { Timestamp } from 'firebase/firestore';
import { DxTagBoxTypes } from 'devextreme-angular/ui/tag-box';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { PodCastCategoriesService } from 'impactdisciplescommon/src/services/data/pod-cast-categories.service';
import { PodCastTagsService } from 'impactdisciplescommon/src/services/data/pod-cast-tags.service';
import { MatDialog } from '@angular/material/dialog';
import { PodCastCategoriesComponent } from '../pod-cast-categories/pod-cast-categories.component';

@Component({
    selector: 'app-pod-casts',
    templateUrl: './pod-casts.component.html',
    styleUrls: ['./pod-casts.component.css'],
    standalone: false
})
export class PodCastsComponent implements OnInit, OnDestroy {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;

  datasource$: Observable<DataSource>;
  selectedItem: PodCastModel;
  podCastCategories: TagModel[] = [];
  itemType = 'Pod Cast'

  public inProgress$ = new BehaviorSubject<boolean>(false);
  public isEditVisible$ = new BehaviorSubject<boolean>(false);
  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);

  podCastTags: TagModel[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(private service: PodCastService,
    private podCastTagService: PodCastTagsService,
    private podCastCategoriesService: PodCastCategoriesService,
    private dialog: MatDialog) {}

  async ngOnInit(): Promise<void> {
      this.datasource$ = this.service.streamAll().pipe(
      map(
        (items) =>
          new DataSource({
            reshapeOnPush: true,
            pushAggregationTimeout: 100,
            store: new CustomStore({
              key: 'id',
              loadMode: 'raw',
              load: function (loadOptions: any) {
                return items;
              }
            })
          })
      )
    );

    this.podCastTagService.streamAll().pipe(takeUntil(this.ngUnsubscribe)).subscribe(tags => {
      this.podCastTags = tags;
    })

    this.podCastCategories = await this.podCastCategoriesService.getAll();

    this.service.getVideoInfo();
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));
    this.isEditVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new PodCastModel()};
    this.selectedItem.date = Timestamp.now().toDate();
    this.isEditVisible$.next(true);
  }

  showCategoriesModal = () => {
    this.dialog.open(PodCastCategoriesComponent, {
      width: '650px'
    });
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

  syncPodcasts = () => {
    confirm('<i>Are you sure you want to syncronize these records?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.inProgress$.next(true);

        this.service.getVideoInfo().then(vids => {
          vids.forEach(async video => {
            let podCast: PodCastModel = await this.service.getById(video.id);

            if(!podCast){
              podCast = {... new PodCastModel()}
            }

            podCast.id = video.id;
            podCast.date = video.snippet.publishedAt;
            podCast.isActive = true;
            podCast.thumbnail = {};
            podCast.thumbnail.name = video.snippet.title;
            podCast.thumbnail.url = video.snippet.thumbnails.maxres ? video.snippet.thumbnails.maxres.url : video.snippet.thumbnails.high.url;
            podCast.title = video.snippet.title;
            podCast.videoId = video.contentDetails.videoId;
            podCast.videoType = "Youtube";
            podCast.description = video.snippet.description;

            await this.service.update(podCast.id, podCast).then(() => {
              notify({
                message: 'Podcasts Synced up with Youtube',
                position: 'top',
                width: 600,
                type: 'success'
              });
              this.inProgress$.next(false);
            });
          })
      })
      }
    });
  }

  onSave(item: PodCastModel) {
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

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isEditVisible$.next(false);
  }

  onCustomItemCreating(args: DxTagBoxTypes.CustomItemCreatingEvent) {
    if(args.text){
      let podCastTag: TagModel = {... new TagModel()}
      podCastTag.tag = args.text;
      podCastTag.id = this.generateRandomId();

      const isItemInDataSource = this.podCastTags.some((item) => item.tag === podCastTag.tag);

      if (!isItemInDataSource) {
        this.podCastTagService.update(podCastTag.id, podCastTag)
      }

      args.customItem = podCastTag;
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

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
