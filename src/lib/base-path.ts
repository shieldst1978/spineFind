/**
 * The app is served under tim-shields.com/spinefind. Next applies this to
 * <Link>, redirects and assets itself; plain HTML things (a <form action>)
 * need it added by hand via `withBase`.
 */
export const BASE_PATH = "/spinefind";

export function withBase(path: string): string {
  return `${BASE_PATH}${path === "/" ? "" : path}`;
}
