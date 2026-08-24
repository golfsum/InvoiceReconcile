import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminDashboard } from "../../src/components/admin/admin-dashboard";
import { adminDemoMetrics } from "../../src/lib/admin/demo-data";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

describe("AdminDashboard", () => {
  it("labels demo metrics and states its privacy boundary", () => {
    render(<AdminDashboard metrics={adminDemoMetrics} />);

    expect(screen.getByText("Demo data")).toBeInTheDocument();
    expect(
      screen.getByText(/customer invoice values are never shown/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/support@invoicereconcile.com/i)).toBeInTheDocument();
  });

  it("applies date, status, and search filters to the signup history", () => {
    render(<AdminDashboard metrics={adminDemoMetrics} />);

    fireEvent.change(screen.getByLabelText("Dashboard date range"), {
      target: { value: "7d" },
    });
    fireEvent.change(
      screen.getByLabelText("Filter signups by subscription status"),
      { target: { value: "trialing" } },
    );
    fireEvent.change(screen.getByLabelText("Search signups"), {
      target: { value: "Dani" },
    });

    const signupSection = screen.getByRole("heading", {
      name: "Signups and customer history",
    }).closest("section");
    expect(signupSection).not.toBeNull();
    expect(within(signupSection!).getByText("Dani Kim")).toBeInTheDocument();
    expect(within(signupSection!).queryByText("Elliot Chen")).not.toBeInTheDocument();
  });
});
