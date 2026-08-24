"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, LoaderCircle, Plus } from "lucide-react";
import { createAdditionalWorkspaceAction } from "@/app/app/workspaces/actions";
import { Button } from "@/components/ui/button";

const field = "mt-1.5 min-h-10 w-full border bg-background px-3 font-normal outline-none focus:border-brand";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{pending ? "Creating workspace" : "Create workspace"}</Button>;
}

export function CreateWorkspaceForm({ organizations }: { organizations: Array<{ id: string; name: string }> }) {
  const [state, action] = useActionState(createAdditionalWorkspaceAction, {});
  return <section className="mt-6 border bg-surface" aria-labelledby="create-workspace-heading">
    <div className="border-b p-5"><div className="flex items-center gap-2"><Building2 className="size-5 text-brand" /><h2 id="create-workspace-heading" className="font-semibold">Add a client workspace</h2></div><p className="mt-1 text-sm text-muted">Workspace availability follows the organization plan: Free and Solo support 1, Business supports 3, and Bookkeeper supports 20.</p></div>
    <form action={action} className="grid gap-4 p-5 lg:grid-cols-6 lg:items-end">
      <label className="text-sm font-semibold lg:col-span-2">Client or business name<input className={field} name="businessName" required maxLength={200} autoComplete="organization" /></label>
      <label className="text-sm font-semibold">Organization<select className={field} name="organizationId" defaultValue={organizations[0]?.id} required>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
      <label className="text-sm font-semibold">Currency<select className={field} name="currency" defaultValue="USD"><option>USD</option><option>CAD</option><option>EUR</option><option>GBP</option><option>AUD</option></select></label>
      <label className="text-sm font-semibold">Timezone<select className={field} name="timezone" defaultValue="America/Phoenix"><option>America/Phoenix</option><option>America/Los_Angeles</option><option>America/Denver</option><option>America/Chicago</option><option>America/New_York</option><option>UTC</option></select></label>
      <div className="flex items-end"><input type="hidden" name="accountingBasis" value="accrual" /><input type="hidden" name="matchDaysAfter" value="90" /><SubmitButton /></div>
      {state.error ? <p className="border border-danger/25 bg-danger-soft p-3 text-sm text-danger lg:col-span-6" role="alert">{state.error}</p> : null}
    </form>
  </section>;
}
