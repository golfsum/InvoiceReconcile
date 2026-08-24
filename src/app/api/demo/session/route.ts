import { NextResponse } from "next/server";
import { createDemoToken, DEMO_COOKIE, demoModeEnabled, type DemoRole } from "@/lib/auth/demo-session";
import { safeReturnPath } from "@/lib/utils";

export async function POST(request: Request) {
  if (!demoModeEnabled()) return Response.json({ error: "Demo mode is not enabled." }, { status: 404 });
  const form = await request.formData().catch(() => new FormData());
  const requestedRole = form.get("role") === "admin" ? "admin" : "member";
  const role: DemoRole = process.env.NODE_ENV === "production" ? "member" : requestedRole;
  const token = await createDemoToken(role);
  if (!token) return Response.json({ error: "Demo session could not be created." }, { status: 503 });
  const returnTo = safeReturnPath(form.get("returnTo")?.toString() || null, role === "admin" ? "/admin" : "/app/demo");
  // Keep the redirect relative so reverse proxies and alternate local hostnames
  // do not move the browser to a different origin than the session cookie.
  const response = new NextResponse(null, { status: 303, headers: { location: returnTo } });
  response.cookies.set(DEMO_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
