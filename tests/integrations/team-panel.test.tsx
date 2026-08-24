import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamPanel, type OrganizationTeamMember } from "@/components/app/team-panel";

const member: OrganizationTeamMember = {
  membershipId: "11800000-0000-4000-8000-000000000001",
  email: "private-colleague@example.com",
  role: "member",
  status: "invited",
  invitedAt: "2026-08-23T12:00:00.000Z",
  expiresAt: "2026-08-30T12:00:00.000Z",
};

describe("team access panel", () => {
  it("does not expose the team roster to a member who cannot manage invitations", () => {
    render(<TeamPanel organizationId="11000000-0000-4000-8000-000000000001" initialMembers={[member]} canManage={false} planEligible />);

    expect(screen.getByText("An organization owner or admin can manage colleague invitations.")).toBeInTheDocument();
    expect(screen.queryByText(member.email)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Revoke invitation for ${member.email}` })).not.toBeInTheDocument();
  });

  it("keeps a pending invitation visible and revocable when the plan is no longer eligible", () => {
    render(<TeamPanel organizationId="11000000-0000-4000-8000-000000000001" initialMembers={[member]} canManage planEligible={false} />);

    expect(screen.getByText("Existing memberships keep access. Upgrade before sending a new invitation.")).toBeInTheDocument();
    expect(screen.getByText(member.email)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Revoke invitation for ${member.email}` })).toBeInTheDocument();
  });
});
