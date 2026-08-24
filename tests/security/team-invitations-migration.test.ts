import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202608230019_organization_team_invitations.sql", "utf8").toLowerCase();

describe("organization invitation database boundary", () => {
  it("removes direct membership mutations from browser clients", () => {
    expect(migration).toContain("revoke insert, delete on public.memberships from authenticated");
    expect(migration).toContain("revoke update on public.memberships from authenticated");
  });

  it("limits base membership reads to the user, organization administrators, and internal admins", () => {
    expect(migration).toContain("drop policy if exists memberships_select_org_member_or_admin");
    expect(migration).toContain("create policy memberships_select_self_or_org_admin");
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("has_org_role(organization_id, array['owner', 'admin'])");
  });

  it("requires an eligible plan and an organization administrator", () => {
    expect(migration).toContain("has_org_role(p_organization_id, array['owner', 'admin'])");
    expect(migration).toContain("v_plan_code not in ('business', 'bookkeeper')");
  });

  it("accepts only unexpired invitations matching a verified auth email", () => {
    expect(migration).toContain("from auth.users u");
    expect(migration).toContain("v_email_confirmed_at is null");
    expect(migration).toContain("lower(m.invited_email) = v_email");
    expect(migration).toContain("m.invitation_expires_at > now()");
    expect(migration).toContain("m.role in ('member', 'viewer')");
    expect(migration).toContain("s.plan_code in ('business', 'bookkeeper')");
    expect(migration).toContain("s.status in ('active', 'trialing', 'past_due')");
  });

  it("uses a delivery generation so a failed request cannot delete a newer invitation", () => {
    expect(migration).toContain("invitation_delivery_id uuid");
    expect(migration).toContain("create or replace function public.rollback_organization_invitation_delivery");
    expect(migration).toContain("m.invitation_delivery_id = p_delivery_id");
    expect(migration).toContain("grant execute on function public.rollback_organization_invitation_delivery(uuid, uuid, uuid) to authenticated");
  });

  it("keeps create, revoke, and acceptance changes in audited security-definer functions", () => {
    expect(migration).toContain("create or replace function public.create_organization_invitation");
    expect(migration).toContain("create or replace function public.revoke_organization_invitation");
    expect(migration).toContain("create or replace function public.accept_my_organization_invitations");
    expect(migration.match(/security definer/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration).toContain("'team.invitation_accepted'");
  });
});
