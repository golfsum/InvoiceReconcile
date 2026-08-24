import { describe, expect, it } from "vitest";
import { newestCompatibleSavedColumnMapping, savedColumnMappingForHeaders } from "@/lib/imports/saved-mapping";

describe("saved column mappings", () => {
  it("reuses a compatible mapping without changing the saved header names", () => {
    expect(savedColumnMappingForHeaders({
      invoiceNumber: "Invoice #",
      customerName: "Client",
      invoiceDate: "Issued",
      originalAmount: "Gross",
    }, ["Invoice #", "Client", "Issued", "Gross", "Notes"], "invoice")).toEqual({
      invoiceNumber: "Invoice #",
      customerName: "Client",
      invoiceDate: "Issued",
      originalAmount: "Gross",
    });
  });

  it("rejects the whole saved mapping when one mapped header is absent", () => {
    expect(savedColumnMappingForHeaders({
      paymentDate: "Posted",
      amount: "Credit",
      payerName: "Originator",
    }, ["Posted", "Credit", "Sender"], "payment")).toBeNull();
  });

  it("rejects empty, cross-kind, and malformed mappings", () => {
    expect(savedColumnMappingForHeaders({}, ["Invoice #"], "invoice")).toBeNull();
    expect(savedColumnMappingForHeaders({ paymentDate: "Date" }, ["Date"], "invoice")).toBeNull();
    expect(savedColumnMappingForHeaders({ invoiceNumber: 42 }, ["Invoice #"], "invoice")).toBeNull();
  });

  it("chooses the newest compatible mapping from a bounded recent set", () => {
    expect(newestCompatibleSavedColumnMapping([
      { paymentDate: "Date", amount: "Amount", payerName: "Missing payer" },
      { paymentDate: "Date", amount: "Amount", payerName: "Sender" },
      { paymentDate: "Legacy date", amount: "Legacy amount" },
    ], ["Date", "Amount", "Sender"], "payment")).toEqual({
      paymentDate: "Date",
      amount: "Amount",
      payerName: "Sender",
    });
  });
});
