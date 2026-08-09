import { fromUnixTime, isDate, isValid, parse } from 'date-fns';

export const dateFromTimestamp = (item) => {
  if (!item) {
    return null;
  }

  if (isDate(item)) {
    return item;
  }

  if (typeof item === 'string') {
    return parseStringDate(item);
  }

  let normalizedDate;

  if (item?.seconds) {
    normalizedDate = fromUnixTime(item.seconds);
  }

  return isValid(normalizedDate) ? normalizedDate : null;
};

const parseStringDate = (dateString: string): null | Date => {
  //console.warn('Wrong Date format detected: all dates must be stored as Timestamp in DB', dateString);

  if (!dateString) {
    return null;
  }
  if (dateString.match(/dd\/dd\/dddd/)) {
    const date = parse(dateString, 'MM/dd/yyyy', new Date());
    return isValid(date) ? date : null;
  }
  //console.warn('Wrong date format detected: unsupported string format', dateString);
  return dateString as any;
};
