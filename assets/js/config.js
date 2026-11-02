// One place for the company name and links. Every page, the demo and the film read these.
// After renaming, re-render the film (tools/record.mjs) so the end card matches.
export const BRAND = 'Rari';
export const ROBOT = 'R2';
export const STATION = 'S2';
export const SITE_URL = 'orbiteval.com';
export const CITY = 'San Jose, California';

// Where reservations go. FormSubmit (formsubmit.co: free, no account) emails each one to CONTACT_EMAIL.
// RESERVE_ENDPOINT uses the alias FormSubmit sent in its activation email, so the form doesn't name the inbox.
// A different inbox means a new activation: put https://formsubmit.co/ajax/<new address> here, submit once, click
// "Activate Form" in the email that arrives, then swap in the alias that email gives.
// CONTACT_EMAIL is shown only when sending fails, so a visitor can still reach us.
// Leave RESERVE_ENDPOINT empty to open the visitor's email app instead.
export const CONTACT_EMAIL = 'rahil@orbiteval.com';
export const RESERVE_ENDPOINT = 'https://formsubmit.co/ajax/eda47b2ced4c7eaa849bd1391ad17e92';
// Optional: a Stripe Payment Link for the refundable founding-building deposit.
export const DEPOSIT_LINK = '';
