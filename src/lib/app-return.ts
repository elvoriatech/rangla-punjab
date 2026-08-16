/**
 * Mobile-app return links for the payment flow. The app opens the web
 * pay page in the system browser and passes its own deep link in `app=`;
 * after settling we surface a "Back to the app" button pointing at it.
 *
 * The URL is REFLECTED into an anchor, so it is allow-listed hard:
 * only our app schemes ever pass — never http(s), never anything else —
 * which closes the open-redirect / javascript: hole by construction.
 *   ranglapunjab://…            the built (standalone) app
 *   exp://… / exp+…://…         Expo Go & dev clients during development
 */
const APP_SCHEME_RE = /^(ranglapunjab|exp|exp\+[a-z0-9-]+):\/\/[\x21-\x7e]{0,512}$/i;

export function sanitizeAppReturnUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = raw.trim();
  return APP_SCHEME_RE.test(url) ? url : null;
}
