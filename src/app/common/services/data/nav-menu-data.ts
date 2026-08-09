import { MenuModel, MobileMenuModel } from "src/app/common/models/utils/nav-menu.model";



const menuData: MenuModel[] = [
  {
    link: '/', title: 'Home', hasDropdown: false , visible: true, external: false, highlight: false
  },
  {
    title: 'Training',
    hasDropdown: true,
    dropdownItems: [
      { link: '/seminars', title: 'Seminars', visible: true, external: false, highlight: false },
      { link: '/equipping-groups', title: 'Equipping Groups', visible: true, external: false, highlight: false },
      { link: '/coaching-with-impact', title: 'Coaching with Impact', visible: true, external: false, highlight: false },
      { link: '/lunch-and-learns', title: 'Lunch and Learns', visible: true, external: false, highlight: false },
      { link: '/events', title: 'Upcoming Training', visible: true, external: false, highlight: false }
    ],
    visible: true,
    external: false,
    highlight: false
  },
  {
    title: 'Resources',
    hasDropdown: true,
    dropdownItems: [
      { link: '/e-books', title: 'E-Books', visible: true, external: false, highlight: false },
      { link: '/podcasts', title: 'Podcasts', visible: true, external: false, highlight: false },
      { link: '/disciple-making-minute', title: 'Disciple-Making Minute', visible: true, external: false, highlight: false },
      { link: '/monthly-newsletter', title: 'Monthly Newsletter', visible: true, external: false, highlight: false },
      { link: '/store?category=spanish-resources', title: 'Spanish Resources', visible: true, external: false, highlight: false },
    ],
    visible: true,
    external: false,
    highlight: false
  },
  { title: 'Store', hasDropdown: true,
    dropdownItems: [
      { link: '/store', title: 'Impact Books', visible: true, external: false, highlight: false },
      { link: 'http://www.asbshops.com/lagrangehub/matthewfrady/impact', title: 'Impact Merchandise', visible: true, external: true, highlight: true }
    ],
    visible: true,
    external: false,
    highlight: false
  },
  { link: '/give', title: 'Donate', hasDropdown: false , visible: true, external: false, highlight: false},
  { link: '/team', title: 'Team', hasDropdown: false, visible: true, external: false, highlight: false},
  { link: '/summit/2027', title: 'Summit 2027', visible: true, external: false, highlight: true },
  { link: 'https://events.golfstatus.com/event/2nd-Annual-Impact-Golf-Tournament', title: 'Impact Golf Tournament', visible: true, external: true, highlight: true }
]

export default menuData;

export const mobileMenuData: MobileMenuModel[] = [
  { link: '/', title: 'Home', visible: true },
  {
    title: 'Training',
    dropdownMenu: [
      { link: '/seminars', title: 'Seminars', visible: true },
      { link: '/equipping-groups', title: 'Equipping Groups', visible: true },
      { link: '/coaching-with-impact', title: 'Coaching with Impact', visible: true },
      { link: '/lunch-and-learns', title: 'Lunch and Learns', visible: true },
      { link: '/events', title: 'Upcoming Training', visible: true }
    ],
    visible: true,
  },
  {
    title: 'Resources',
    dropdownMenu: [
      { link: '/e-books', title: 'E-Books', visible: true },
      { link: '/podcasts', title: 'Podcasts', visible: true },
      { link: '/disciple-making-minute', title: 'Disciple-Making Minute', visible: true },
      { link: '/monthly-newsletter', title: 'Monthly Newsletter', visible: true },
      { link: '/store?category=spanish-resources', title: 'Spanish Resources', visible: true },
    ],
    visible: true
  },
  { link: '/store', title: 'Store', visible: true },
  { link: '/give', title: 'Donate', visible: true },
  { link: '/team', title: 'Team', visible: true },
  { link: '/summit/2027', title: 'Summit 2027', external: false, visible: true, highlight: true },

]
