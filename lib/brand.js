// A server can show a brand of its own in the dashboard: NEXT_PUBLIC_APP_NAME for the name (titles, the sidebar, its
// own emails) and NEXT_PUBLIC_BRAND_MARK_URL for a square image in the plane's place. Read at build time, so set
// them for builds too. Unset, it's MailCheap.
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "MailCheap";
export const BRAND_MARK_URL = process.env.NEXT_PUBLIC_BRAND_MARK_URL || "";
