export interface MenuModel {
  link?: string,
  title: string,
  hasDropdown?: boolean,
  megamenu?: boolean,
  dropdownItems?: {
    link: string
    title: string,
    dropdownMenu?: DropdownMenuModel[],
    visible: boolean | string,
    external: boolean | string,
    highlight?: boolean | string
  }[],
  visible: boolean,
  external: boolean | string,
  highlight?: boolean | string
}

export interface MobileMenuModel{
  title: string;
  link?: string;
  external?: boolean,
  highlight?: boolean | string
  dropdownMenu?: DropdownMenuModel[];
  visible: boolean;
}

export interface DropdownMenuModel {
  link: string;
  title: string;
  visible: boolean;
}
