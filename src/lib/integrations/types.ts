export const integrationProviders = ["quickbooks", "xero", "plaid", "stripe", "square"] as const;
export type IntegrationProvider = (typeof integrationProviders)[number];

export type IntegrationConnectionStatus =
  | "disconnected"
  | "pending"
  | "connected"
  | "degraded"
  | "revoked"
  | "error";

export type IntegrationCapability =
  | "import_invoices"
  | "import_payments"
  | "import_bank_transactions"
  | "import_payouts"
  | "continuous_sync";

export type StoredIntegrationConnection = {
  provider: IntegrationProvider;
  status: IntegrationConnectionStatus;
  connected_at?: string | null;
  last_synced_at?: string | null;
  last_error_code?: string | null;
};

export type IntegrationConnectionState = {
  provider: IntegrationProvider;
  name: string;
  status: IntegrationConnectionStatus;
  capabilities: IntegrationCapability[];
  configured: boolean;
  connectionFlow: "not_configured" | "not_implemented";
  connectedAt: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
};

export type IntegrationAdapter = {
  provider: IntegrationProvider;
  name: string;
  capabilities: IntegrationCapability[];
  requiredEnvironmentVariables: readonly string[];
};
