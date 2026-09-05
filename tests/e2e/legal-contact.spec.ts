import { expect, test } from "@playwright/test";
import { rejectOptionalAnalytics } from "./helpers";

test("terms and privacy pages publish the support contact and substantive policies", async ({ page }) => {
  await page.goto("/terms");
  await rejectOptionalAnalytics(page);
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the Service does" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Email support" })).toHaveAttribute("href", "mailto:support@invoicereconcile.com");

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retention and deletion" })).toBeVisible();
  await expect(page.getByText("support@invoicereconcile.com", { exact: false }).first()).toBeVisible();
});

test("the contact form sends a correctly shaped support request without external delivery", async ({ page }) => {
  let submittedPayload: Record<string, unknown> | undefined;
  await page.route("**/api/contact", async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ accepted: true, message: "Your request was sent." }),
    });
  });

  await page.goto("/contact");
  await rejectOptionalAnalytics(page);
  await expect(page.getByRole("heading", { level: 1, name: "Contact InvoiceReconcile" })).toBeVisible();
  await page.getByLabel("Name").fill("Casey Morgan");
  await page.getByLabel("Work email").fill("casey@example.com");
  await page.getByLabel("Topic").selectOption("privacy");
  await page.getByLabel("Message").fill("Please explain how I can request a copy of my account data.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("status")).toContainText("Your request was sent.");
  expect(submittedPayload).toMatchObject({
    name: "Casey Morgan",
    email: "casey@example.com",
    subject: "privacy",
    message: "Please explain how I can request a copy of my account data.",
    companyWebsite: "",
    sourcePath: "/contact",
  });
});
