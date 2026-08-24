import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck, ShieldCheck } from "lucide-react";
import { acceptOrganizationInvitationAction } from "./actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Accept team invitation", robots: { index: false, follow: false } };

type PendingInvitation = {
  membership_id: string;
  organization_name: string;
  invited_role: string;
  invitation_expires_at: string;
};

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("/auth/accept-invite");
  const query = await searchParams;
  const supabase = await getSupabaseServerClient();
  const result = supabase ? await supabase.rpc("get_my_pending_organization_invitations") : { data: null, error: new Error("unavailable") };
  const verificationRequired = Boolean(result.error && typeof result.error === "object"
    && "code" in result.error && result.error.code === "42501");
  const invitations = !result.error && Array.isArray(result.data)
    ? result.data.filter((value): value is PendingInvitation => Boolean(value && typeof value === "object"
      && typeof (value as Record<string, unknown>).membership_id === "string"
      && typeof (value as Record<string, unknown>).organization_name === "string"
      && typeof (value as Record<string, unknown>).invited_role === "string"
      && typeof (value as Record<string, unknown>).invitation_expires_at === "string"))
    : null;

  return <AuthShell title="Accept team invitation" description={`Signed in as ${user.email}. Access is granted only for invitations addressed to this verified email.`}>
    {query.error === "verification_required" || verificationRequired ? <div className="border border-warning/30 bg-warning-soft p-4 text-sm text-warning" role="alert">Verify this account email before accepting an organization invitation.</div> : query.error === "unavailable" || invitations === null ? <div className="border border-warning/30 bg-warning-soft p-4 text-sm text-warning" role="alert">Invitations are temporarily unavailable. No organization access was changed.</div> : invitations.length ? <div className="space-y-5"><div className="divide-y border-y">{invitations.map((invitation) => <div className="py-4" key={invitation.membership_id}><div className="flex items-center gap-2"><MailCheck className="size-4 text-brand" /><p className="font-semibold">{invitation.organization_name}</p></div><p className="mt-1 text-sm capitalize text-muted">{invitation.invited_role} access</p></div>)}</div><div className="flex gap-3 bg-brand-soft p-3 text-sm text-muted-strong"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" /><p>Accepting adds your verified account to the {invitations.length === 1 ? "listed organization" : "listed organizations"}. Financial records remain isolated by organization and workspace permissions.</p></div><form action={acceptOrganizationInvitationAction}><Button className="w-full" size="lg" type="submit"><MailCheck className="size-4" /> {invitations.length === 1 ? "Accept and open workspace" : "Accept all and open workspace"}</Button></form></div> : <div className="space-y-4"><p className="border bg-surface-muted p-4 text-sm text-muted">No active invitation matches this verified email. The invitation may have expired, been revoked, be waiting for the organization to restore team access, or have been sent to another address.</p><Link className="block text-center text-sm font-semibold text-brand hover:underline" href="/app">Return to the app</Link></div>}
  </AuthShell>;
}
