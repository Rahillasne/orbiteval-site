// One place for the company name and links. Every page, the demo and the film read these.
// After renaming, re-render the film (tools/record.mjs) so the end card matches.
export const BRAND = 'Rari';
export const ROBOT = 'R2';
export const STATION = 'S2';
export const SITE_URL = 'orbiteval.com';
export const CITY = 'San Jose, California';

// Where reservations go. FormSubmit (formsubmit.co: free, no account) emails each one to CONTACT_EMAIL. The first
// submission from a new site sends CONTACT_EMAIL an "Activate Form" email; reservations arrive once that's clicked.
// A new CONTACT_EMAIL needs activating again. Leave RESERVE_ENDPOINT empty to open the visitor's email app instead.
export const CONTACT_EMAIL = 'rahil@orbiteval.com';
export const RESERVE_ENDPOINT = `https://formsubmit.co/ajax/${CONTACT_EMAIL}`;
// Optional: a Stripe Payment Link for the refundable founding-building deposit.
export const DEPOSIT_LINK = '';
