import { Component, OnInit, ViewChild } from "@angular/core";
import { DxTreeListComponent } from "devextreme-angular";
import CustomStore from "devextreme/data/custom_store";
import { Role } from "impactdisciplescommon/src/lists/roles.enum";
import { Tab } from "impactdisciplescommon/src/models/utils/tab.model";
import { MenuItem } from "../common/models/editor/menu.model";
import { Page } from "../common/models/editor/page.model";
import { MenuService } from "../common/services/menu.service";
import { PageService } from "../common/services/page.service";
import { AGENT_TYPE } from "../common/lists/agent-type.enum";


@Component({
  selector: "app-menu-administration",
  templateUrl: "./menu-administration.component.html",
})
export class MenuAdministrationComponent implements OnInit {
  @ViewChild("menuItems", { static: false }) tree: DxTreeListComponent;

  breadCrumbItems: Array<{}>;
  pageItems: Page[] = [];
  pageList: any;
  parentList: any;
  roles: any[] = [];
  store: CustomStore;
  editType: string = "link";
  selectedMenuItem: MenuItem;

  showIconList: boolean = false;

  isMovingParent: boolean = false;

  tabs: Tab[] = [
    {
      id: 0,
      text: "Material Design Icons",
      template: "MaterialDesign",
    },
    {
      id: 1,
      text: "FontAwesome Icons",
      template: "FontAwesome",
    },
    {
      id: 2,
      text: "Drip Icons",
      template: "Drip",
    },
    {
      id: 3,
      text: "Remix Icons",
      template: "Remix",
    },
  ];

  selectedTab: string = "MaterialDesign";

  constructor(
    private menuService: MenuService,
    private pageService: PageService,
  ) {
    this.onReorder = this.onReorder.bind(this);

    this.store = new CustomStore({
      key: "dbId",
      load: (loadOptions) => {
        return new Promise<MenuItem[]>((resolve) => {
          this.menuService.getAll().then(
            (snaps) => {
              this.buildParentList(snaps);

              this.editType = "link";

              resolve(snaps);
            },
            (err) => console.error("Error in Menu Admin", err)
          );
        });
      },
      insert: (menuItem: MenuItem) => {
        menuItem.order = 0;
        menuItem.is_external = false;
        return this.menuService.add(menuItem);
      },
      update: (key, menuItem: MenuItem) => {
        return this.menuService.update(key, menuItem);
      },
      remove: (key) => {
        return this.menuService.delete(key);
      },
    });
  }

  prepSnaps(items: MenuItem[]): MenuItem[] {
    let finalList: MenuItem[] = [];

    items.forEach((snap) => {
      snap.parentId = "Root";

      let order: number = 1;

      snap.subItems.forEach((subsnap) => {
        subsnap.parentId = snap.dbId;
        subsnap.order = order++;
        delete subsnap.subItems;
        delete subsnap.id;
        finalList.push(subsnap);
      });

      delete snap.subItems;
      delete snap.id;

      finalList.push(snap);
    });

    finalList.forEach((i) => {
      this.menuService.update(i.dbId, i);
    });

    return finalList;
  }

  ngOnInit(): void {
    this.breadCrumbItems = [
      { label: "Admin" },
      { label: "Menu Administration", active: true },
    ];

    for (const value in Role) {
      this.roles.push(value);
    }

    for (const value in AGENT_TYPE) {
      this.roles.push(value);
    }

    this.pageService.getAll().then(
      (pages) => {
        this.buildPageList(pages);
      },
      (err) => console.error("Error in Menu Admin", err)
    );
  }

  buildPageList(pages: Page[]) {
    let pageKVPair: {}[] = [];

    pages.forEach((page) => {
      pageKVPair.push({
        name: page.name,
        id: "/pages/page-viewer/" + page.dbId,
      });
    });

    pageKVPair.push({
      name: "Store",
      id: "/ecommerce/products",
    });

    pageKVPair.push({
      name: "Training Calendar",
      id: "/pages/scheduler",
    });

    pageKVPair.push({
      name: "Personal View New",
      id: "/dashboard/agent-dashboard-new",
    });

    pageKVPair.push({
      name: "Personal View",
      id: "/dashboard/agent-dashboard",
    });

    pageKVPair.push({
      name: "Agency View",
      id: "/dashboard/mga-dashboard",
    });

    pageKVPair.push({
      name: "Alliance Group View",
      id: "/dashboard/alliance-group-dashboard",
    });

    pageKVPair.push({
      name: "RMD View",
      id: "/dashboard/rmd-dashboard",
    });

    pageKVPair.push({
      name: "Manager View",
      id: "/dashboard/manager-dashboard",
    });

    this.pageList = {
      store: pageKVPair,
      sort: "name",
    };
  }

  buildParentList(parents: MenuItem[]) {
    let parentKVPair: {}[] = [];

    parentKVPair.push({
      name: "Root",
      id: "Root",
    });

    parents.forEach((parent) => {
      if (parent.type == "folder") {
        parentKVPair.push({
          name: parent.label,
          id: parent.dbId,
        });
      }
    });

    this.parentList = {
      store: parentKVPair,
      sort: "name",
    };
  }

  onReorder(e) {
    const visibleRows = e.component.getVisibleRows();
    const sourceData = e.itemData;
    const targetNode = visibleRows[e.toIndex].node;

    if (e.dropInsideItem) {
      //set the order to 0 and reassign parent
      sourceData.order = 0;
      sourceData.parentId = targetNode.data.dbId;

      this.menuService.update(sourceData.dbId, sourceData);
    } else {
      let menuItems: MenuItem[] = [];

      visibleRows.forEach((row) => {
        menuItems.push(row.data);
      });

      // //remove source from list
      menuItems.splice(e.fromIndex, 1);

      // //place source in list
      menuItems.splice(e.toIndex, 0, sourceData);

      let newOrder: number = 1;

      menuItems.forEach((mi) => {
        if (mi.parentId == sourceData.parentId) {
          mi.order = newOrder++;
          this.menuService.update(mi.dbId, mi);
        }
      });
    }

    this.tree.instance.refresh();
  }

  onRowPrepared(e) {
    if (e.rowType == "data" && e.data.type == "folder") {
      e.rowElement.style.backgroundColor = "LightGray";
    }
  }

  onRowUpdating(options) {
    if (options.newData.parentId) {
      this.isMovingParent = true;
    } else {
      this.isMovingParent = false;
    }

    options.newData = Object.assign(options.oldData, options.newData);
  }

  onRowUpdated(e) {
    this.editType = "link";
  }

  onRowRemoving(e) {
    if (e.data) {
      this.selectedMenuItem = e.data;
    }
  }

  onEditorPreparing(e) {
    if (e.row) {
      this.selectedMenuItem = e.row.data;
    }

    if (e.dataField === "type" && e.row.data.type === "folder") {
      this.editType = "folder";
    }

    if (this.editType == "folder") {
      if (e.cellElement) {
        e.cellElement.css("background-color", "red");
      }

      if (
        e.dataField == "link" ||
        e.dataField == "is_external" ||
        e.dataField == "parentId"
      ) {
        e.editorOptions.disabled = true;
      }
    }
  }

  onEditCanceled(e) {
    this.editType = "link";
  }

  onToolbarPreparing(e) {
    e.toolbarOptions.items.unshift({
      location: "after",
      widget: "dxButton",
      options: {
        text: "View Icon List",
        onClick: this.displayIconScreen.bind(this),
      },
    });
  }

  initNewRow(e) {
    e.data.parentId = "Root";
  }

  displayIconScreen() {
    this.showIconList = true;
  }

  selectTab(e) {
    this.selectedTab = e.itemData.template;
  }
}
