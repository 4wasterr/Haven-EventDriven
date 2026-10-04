import { COUNTRIES } from './validation.mjs';
export const countdown = (deadline, now = Date.now()) => {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
export const timeZoneFor = account => COUNTRIES[account.country]?.regions[account.region]?.zone || COUNTRIES[account.country]?.zone || 'UTC';
export const formatTime = (timestamp, zone) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(timestamp));
