import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const DEMO_COOKIE = "ir_demo_session";

export type DemoRole = "member" | "admin";
export type DemoClaims = { sub: string; email: string; name: string; role: DemoRole };

function demoSecret() {
  const configured = process.env.DEMO_SESSION_SECRET;
  if (configured) return new TextEncoder().encode(configured);
  if (process.env.NODE_ENV !== "production") return new TextEncoder().encode("invoicereconcile-local-demo-only");
  return null;
}

export function demoModeEnabled() {
  return process.env.ENABLE_DEMO_MODE === "true" || process.env.NODE_ENV !== "production";
}

export async function createDemoToken(role: DemoRole = "member") {
  const secret = demoSecret();
  if (!secret || !demoModeEnabled()) return null;
  const claims: DemoClaims = {
    sub: role === "admin" ? "demo-admin" : "demo-bookkeeper",
    email: role === "admin" ? "admin@demo.invoicereconcile.com" : "bookkeeper@demo.invoicereconcile.com",
    name: role === "admin" ? "Demo Admin" : "Jordan Lee",
    role,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .setIssuer("invoicereconcile-demo")
    .setAudience("invoicereconcile-local")
    .sign(secret);
}

export async function readDemoSession() {
  const secret = demoSecret();
  if (!secret || !demoModeEnabled()) return null;
  const cookieStore = await cookies();
  const token = cookieStore.get(DEMO_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: "invoicereconcile-demo",
      audience: "invoicereconcile-local",
    });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.name !== "string") return null;
    const role = payload.role === "admin" ? "admin" : "member";
    return { sub: payload.sub, email: payload.email, name: payload.name, role } satisfies DemoClaims;
  } catch {
    return null;
  }
}
