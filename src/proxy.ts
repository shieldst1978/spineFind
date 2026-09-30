import { NextResponse, type NextRequest } from "next/server";

/**
 * Second line of defence behind Azure Container Apps authentication.
 *
 * On Azure, Microsoft sign-in runs in front of the app and adds the signed-in
 * user's name to every request as `x-ms-client-principal-name`. This refuses
 * anyone not listed in AUTH_ALLOWED_USERS (comma-separated emails). With that
 * variable unset, as in local development, every request is allowed.
 */
// App icons are fetched by the phone's home screen without the sign-in cookie,
// so they must be reachable without signing in. They reveal nothing private.
const PUBLIC_ICON = /\/(icon\.svg|apple-icon\.png|apple-touch-icon(-precomposed)?\.png)$/;

export function proxy(request: NextRequest) {
  if (PUBLIC_ICON.test(request.nextUrl.pathname)) return NextResponse.next();

  const allowed = (process.env.AUTH_ALLOWED_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return NextResponse.next();

  const user = request.headers.get("x-ms-client-principal-name")?.toLowerCase();
  if (user && allowed.includes(user)) return NextResponse.next();

  return new NextResponse(
    user
      ? `Signed in as ${user}, which isn't allowed to use SpineFind. Sign out at /.auth/logout.`
      : "Sign-in required.",
    { status: user ? 403 : 401, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

export const config = {
  // Everything except Next's static files and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
