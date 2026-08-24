"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Clock3, LoaderCircle, MailPlus, ShieldCheck, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type OrganizationTeamMember = {
  membershipId: string;
  email: string;
  displayName?: string;
  role: "owner" | "admin" | "member" | "viewer";
  status: "active" | "invited" | "expired" | "suspended";
  invitedAt?: string;
  joinedAt?: string;
  expiresAt?: string;
};

type InvitationResponse = {
  invitation?: {
    membershipId?: unknown;
    email?: unknown;
    role?: unknown;
    status?: unknown;
    invitedAt?: unknown;
    expiresAt?: unknown;
  };
  delivered?: unknown;
  deliveryMode?: unknown;
  error?: unknown;
};

function responseError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

function parseInvitation(value: InvitationResponse): OrganizationTeamMember | null {
  const invitation = value.invitation;
  if (!invitation || typeof invitation.membershipId !== "string" || typeof invitation.email !== "string"
      || (invitation.role !== "member" && invitation.role !== "viewer") || invitation.status !== "invited"
      || typeof invitation.invitedAt !== "string" || typeof invitation.expiresAt !== "string") return null;
  return {
    membershipId: invitation.membershipId,
    email: invitation.email,
    role: invitation.role,
    status: "invited",
    invitedAt: invitation.invitedAt,
    expiresAt: invitation.expiresAt,
  };
}

function statusLabel(member: OrganizationTeamMember) {
  if (member.status === "active") return "Active";
  if (member.status === "invited") return "Invitation pending";
  if (member.status === "expired") return "Invitation expired";
  return "Suspended";
}

export function TeamPanel({ organizationId, initialMembers, canManage, planEligible }: {
  organizationId: string;
  initialMembers: OrganizationTeamMember[] | null;
  canManage: boolean;
  planEligible: boolean;
}) {
  const [members, setMembers] = useState(initialMembers || []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [sending, setSending] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = await response.json().catch(() => null) as InvitationResponse | null;
      if (!response.ok) throw new Error(responseError(body, "The invitation could not be sent."));
      const invitation = body ? parseInvitation(body) : null;
      if (!invitation) throw new Error("The saved invitation could not be confirmed.");
      setMembers((current) => [...current.filter((member) => member.membershipId !== invitation.membershipId), invitation]);
      setEmail("");
      toast.success(body?.delivered === true ? "Invitation sent" : "Invitation saved for local testing", {
        description: body?.delivered === true
          ? "The colleague has seven days to join with the invited email."
          : "Postmark is not configured in this local environment, so no email was delivered.",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function revoke(member: OrganizationTeamMember) {
    setRevokingId(member.membershipId);
    setError(null);
    try {
      const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/invitations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: member.membershipId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "The invitation could not be revoked."));
      setMembers((current) => current.filter((item) => item.membershipId !== member.membershipId));
      toast.success("Invitation revoked");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be revoked.");
    } finally {
      setRevokingId(null);
    }
  }

  return <section className="mt-6 border bg-surface" aria-labelledby="team-heading">
    <div className="border-b p-5"><div className="flex items-center gap-2"><Users className="size-5 text-brand" /><h2 id="team-heading" className="font-semibold">Team access</h2></div><p className="mt-1 text-sm text-muted">Invite a colleague without sharing a password. Access is granted only after the colleague signs in with the verified invited email.</p></div>
    {!canManage ? <p className="p-5 text-sm text-muted">An organization owner or admin can manage colleague invitations.</p> : initialMembers === null ? <div className="p-5 text-sm text-warning" role="alert">Team access is temporarily unavailable. No member list is being substituted.</div> : <>
      {planEligible ? <form className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_170px_auto] md:items-end" aria-busy={sending} onSubmit={(event) => void invite(event)}><label className="text-sm font-semibold">Colleague email<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" type="email" value={email} maxLength={320} required autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="colleague@company.com" /></label><label className="text-sm font-semibold">Access level<select className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={role} onChange={(event) => setRole(event.target.value as "member" | "viewer")}><option value="member">Member</option><option value="viewer">Viewer</option></select></label><Button className="w-full md:w-auto" type="submit" disabled={sending}>{sending ? <LoaderCircle className="size-4 animate-spin" /> : <MailPlus className="size-4" />}{sending ? "Sending invitation" : "Invite colleague"}</Button></form> : <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Colleague invitations are available on Business and Bookkeeper.</p><p className="mt-1 text-sm text-muted">Existing memberships keep access. Upgrade before sending a new invitation.</p></div><Link className="inline-flex min-h-10 shrink-0 items-center justify-center border border-brand bg-brand px-4 text-sm font-semibold text-white" href={`/settings/billing?organizationId=${encodeURIComponent(organizationId)}`}>Compare team plans</Link></div>}
      {error ? <p className="border-t px-5 py-3 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="border-t"><div className="flex items-center justify-between gap-4 px-5 py-3"><p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Organization members</p><span className="text-xs text-muted" aria-live="polite">{members.length} {members.length === 1 ? "person" : "people"}</span></div><div className="divide-y border-t">{members.map((member) => <div className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_130px_180px_auto] md:items-center" key={member.membershipId}><div className="flex min-w-0 items-center gap-3"><span className="inline-flex size-9 shrink-0 items-center justify-center bg-surface-muted text-muted"><UserRound className="size-4" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{member.displayName || member.email}</p>{member.displayName ? <p className="truncate text-xs text-muted">{member.email}</p> : null}</div></div><span className="w-fit bg-surface-muted px-2 py-1 text-xs font-semibold capitalize text-muted-strong">{member.role}</span><span className={`inline-flex w-fit items-center gap-1.5 text-xs font-semibold ${member.status === "active" ? "text-success" : member.status === "suspended" ? "text-danger" : "text-warning"}`}>{member.status === "active" ? <ShieldCheck className="size-4" /> : <Clock3 className="size-4" />}{statusLabel(member)}</span>{(member.status === "invited" || member.status === "expired") ? <button type="button" className="inline-flex size-10 items-center justify-center border text-muted hover:border-danger hover:text-danger disabled:cursor-wait disabled:opacity-60 md:justify-self-end" aria-label={`Revoke invitation for ${member.email}`} disabled={revokingId === member.membershipId} onClick={() => void revoke(member)}>{revokingId === member.membershipId ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button> : <span />}</div>)}{members.length === 0 ? <p className="p-6 text-center text-sm text-muted">No organization memberships are available.</p> : null}</div></div>
    </>}
  </section>;
}
