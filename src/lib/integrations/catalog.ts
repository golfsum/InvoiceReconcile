import type {
  IntegrationAdapter,
  IntegrationConnectionState,
  IntegrationProvider,
  StoredIntegrationConnection,
} from "@/lib/integrations/types";

export const integrationAdapters: Record<IntegrationProvider, IntegrationAdapter> = {
  quickbooks: {
    provider: "quickbooks",
    name: "QuickBooks Online",
    capabilities: ["import_invoices", "import_payments", "continuous_sync"],
    requiredEnvironmentVariables: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"],
  },
  xero: {
    provider: "xero",
    name: "Xero",
    capabilities: ["import_invoices", "import_payments", "continuous_sync"],
    requiredEnvironmentVariables: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
  },
  plaid: {
    provider: "plaid",
    name: "Plaid",
    capabilities: ["import_bank_transactions", "continuous_sync"],
    requiredEnvironmentVariables: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
  },
  stripe: {
    provider: "stripe",
    name: "Stripe",
    capabilities: ["import_payments", "import_payouts", "continuous_sync"],
    requiredEnvironmentVariables: ["STRIPE_CONNECT_CLIENT_ID", "STRIPE_SECRET_KEY"],
  },
  square: {
    provider: "square",
    name: "Square",
    capabilities: ["import_payments", "import_payouts", "continuous_sync"],
    requiredEnvironmentVariables: ["SQUARE_APPLICATION_ID", "SQUARE_APPLICATION_SECRET"],
  },
};

export function isIntegrationConfigured(
  provider: IntegrationProvider,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return integrationAdapters[provider].requiredEnvironmentVariables.every(
    (name) => Boolean(environment[name]?.trim()),
  );
}

export function connectionStates(
  stored: StoredIntegrationConnection[] = [],
  environment: NodeJS.ProcessEnv = process.env,
): IntegrationConnectionState[] {
  const records = new Map(stored.map((connection) => [connection.provider, connection]));
  return (Object.keys(integrationAdapters) as IntegrationProvider[]).map((provider) => {
    const adapter = integrationAdapters[provider];
    const record = records.get(provider);
    const configured = isIntegrationConfigured(provider, environment);
    return {
      provider,
      name: adapter.name,
      capabilities: adapter.capabilities,
      configured,
      connectionFlow: configured ? "not_implemented" : "not_configured",
      status: record?.status || "disconnected",
      connectedAt: record?.connected_at || null,
      lastSyncedAt: record?.last_synced_at || null,
      lastErrorCode: record?.last_error_code || null,
    };
  });
}
