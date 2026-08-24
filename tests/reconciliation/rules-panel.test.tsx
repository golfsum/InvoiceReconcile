import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RulesPanel } from "@/components/app/rules-panel";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const workspaceId = "11000000-0000-4000-8000-000000000001";
const customer = { id: "11100000-0000-4000-8000-000000000001", name: "Acme Consulting LLC", externalId: "ACME-001" };

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("RulesPanel", () => {
  it("restores valid browser-saved demo rules", async () => {
    window.localStorage.setItem("ir_demo_rules_v1", JSON.stringify([{
      id: "saved-rule",
      pattern: "SAVED PAYER",
      customer: "Saved Customer LLC",
      type: "payer_alias",
    }]));
    render(<RulesPanel mode="demo" />);
    await waitFor(() => expect(screen.getByText("SAVED PAYER")).toBeInTheDocument());
    expect(screen.getByText("Saved Customer LLC")).toBeInTheDocument();
    expect(screen.getByText(/Demo rules are not applied to the sample reconciliation/)).toBeInTheDocument();
    expect(screen.getByText(/These are not used by sample matching/)).toBeInTheDocument();
  });

  it("adds a live payer mapping through the workspace route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      existing: false,
      rule: {
        id: "11800000-0000-4000-8000-000000000001",
        alias: "Parent Treasury",
        normalizedAlias: "PARENT TREASURY",
        customerId: customer.id,
        customerName: customer.name,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesPanel mode="live" workspaceId={workspaceId} initialRules={[]} customers={[customer]} canEdit />);

    fireEvent.change(screen.getByLabelText("Payer name"), { target: { value: "Parent Treasury" } });
    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));

    await waitFor(() => expect(screen.getByText("Parent Treasury")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/rules`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ alias: "Parent Treasury", customerId: customer.id }),
    }));
    expect(screen.getByText("Acme Consulting LLC")).toBeInTheDocument();
  });

  it("keeps viewer access read only", () => {
    render(<RulesPanel
      mode="live"
      workspaceId={workspaceId}
      initialRules={[{
        id: "11800000-0000-4000-8000-000000000001",
        alias: "Parent Treasury",
        normalizedAlias: "PARENT TREASURY",
        customerId: customer.id,
        customerName: customer.name,
        customerExternalId: customer.externalId,
        createdAt: "2026-08-23T12:00:00.000Z",
      }]}
      customers={[customer]}
      canEdit={false}
    />);
    expect(screen.getByText(/Viewers can inspect active rules/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add mapping" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete rule/ })).not.toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
  });

  it("edits a live payer mapping through the audited workspace route", async () => {
    const ruleId = "11800000-0000-4000-8000-000000000001";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      existing: false,
      rule: {
        id: ruleId,
        alias: "Updated Treasury",
        normalizedAlias: "UPDATED TREASURY",
        customerId: customer.id,
        customerName: customer.name,
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesPanel
      mode="live"
      workspaceId={workspaceId}
      initialRules={[{
        id: ruleId,
        alias: "Parent Treasury",
        normalizedAlias: "PARENT TREASURY",
        customerId: customer.id,
        customerName: customer.name,
        customerExternalId: customer.externalId,
        createdAt: "2026-08-23T12:00:00.000Z",
      }]}
      customers={[customer]}
      canEdit
    />);

    fireEvent.click(screen.getByRole("button", { name: "Edit rule Parent Treasury" }));
    fireEvent.change(screen.getByLabelText("Payer name", { selector: "input[value='Parent Treasury']" }), { target: { value: "Updated Treasury" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Updated Treasury")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/rules`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ ruleId, alias: "Updated Treasury", customerId: customer.id }),
    }));
  });

  it("creates a bounded reference template from the Business rule editor", async () => {
    const ruleId = "11800000-0000-4000-8000-000000000002";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      existing: false,
      rule: {
        id: ruleId,
        kind: "reference_template",
        sourcePattern: "NS-2026-{digits}",
        normalizedPattern: "NS-2026-{DIGITS}",
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesPanel
      mode="live"
      workspaceId={workspaceId}
      initialRules={[]}
      initialCustomRules={[]}
      customers={[customer]}
      canEdit
      customRulesEnabled
      plan="business"
    />);

    fireEvent.change(screen.getByLabelText("Rule type"), { target: { value: "reference_template" } });
    fireEvent.change(screen.getByLabelText("Payment text pattern"), { target: { value: "NS-2026-{digits}" } });
    fireEvent.click(screen.getByRole("button", { name: "Add custom rule" }));

    await waitFor(() => expect(screen.getByText("NS-2026-{digits}")).toBeInTheDocument());
    expect(screen.getByText("Extract a matching invoice reference")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/rules`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ type: "reference_template", pattern: "NS-2026-{digits}" }),
    }));
  });

  it("keeps downgraded custom rules inspectable and removable without applying them", () => {
    render(<RulesPanel
      mode="live"
      workspaceId={workspaceId}
      initialRules={[]}
      initialCustomRules={[{
        id: "11800000-0000-4000-8000-000000000003",
        kind: "accepted_fee_behavior",
        sourcePattern: "Card settlement",
        normalizedPattern: "CARD SETTLEMENT",
        maximumFeeMinor: 500,
        maximumFeeBasisPoints: 300,
      }]}
      customers={[customer]}
      canEdit
      customRulesEnabled={false}
      plan="solo"
    />);
    expect(screen.getByText("Card settlement")).toBeInTheDocument();
    expect(screen.getByText(/they are not applied on the current plan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit custom rule/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete custom rule Card settlement" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Compare plans" })).toHaveAttribute("href", "/settings/billing");
  });
});
