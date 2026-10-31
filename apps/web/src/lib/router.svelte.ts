/** The pages, in rail order; anything else is a 404. */
export const PAGES = { "/": "Home", "/topology": "Topology", "/timeline": "Timeline", "/alerts": "Alerts", "/apps": "Apps",
  "/backups": "Backups", "/security": "Security", "/settings": "Settings" } as const;
export type PagePath = keyof typeof PAGES;
export const isPage = (p: string): p is PagePath => Object.hasOwn(PAGES, p);

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p) || "/";
/** The current path; the History API is the only source of truth. */
export const route = $state({ path: norm(location.pathname) });

export function go(href: string) {
  const u = new URL(href, location.href);
  if (u.href === location.href) return;
  history.pushState(null, "", u);
  route.path = norm(u.pathname);
  scrollTo(0, 0);
}
addEventListener("popstate", () => { route.path = norm(location.pathname); });
// same-origin plain left clicks on links stay in the page; new-tab clicks, downloads and other sites are the browser's
document.addEventListener("click", e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
  e.preventDefault(); go(a.href);
});
