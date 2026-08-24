import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("transactional email safety", () => {
  it("escapes contact content before placing it in HTML", async () => {
    const { escapeHtml } = await import("@/lib/email");
    expect(escapeHtml(`<script>alert("x")</script> & more`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more",
    );
  });
});
