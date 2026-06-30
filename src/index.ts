import { CONSTANTS, DASHBOARD_CONFIG_LOOKUP, DASHBOARD_CONFIGS } from "./constants";
import { DashboardProcessor } from "./dashboard";
import { COLUMN_CONFIG } from "./metrics";
import { PROVIDER_IDS, createProvider } from "./provider";
import { logger } from "./logger";
import { GoogleSheetsClient } from "./sheets";
import { StockInputGroup } from "./types";

function resolveApiKey(providerId: string): string {
  switch (providerId.toLowerCase()) {
    case PROVIDER_IDS.FMP:
      return process.env.FMP_API_KEY?.trim() || CONSTANTS.FMP_API_KEY;
    case PROVIDER_IDS.ALPHA_VANTAGE:
    case "alphavantage":
    case "alpha_vantage":
      return process.env.ALPHA_VANTAGE_API_KEY?.trim() || CONSTANTS.ALPHA_VANTAGE_API_KEY;
    case PROVIDER_IDS.TIINGO:
      return process.env.TIINGO_API_KEY?.trim() || CONSTANTS.TIINGO_API_KEY;
    default:
      return "";
  }
}

const sheetClient = createSheetsClient();

function resolveProviderId(input: StockInputGroup): string {
  return input.DATA_PROVIDER;
}

function resolveDashboardConfigs(): StockInputGroup[] {
  const selectedConfigName = process.env.DASHBOARD_CONFIG_NAME?.trim();

  if (!selectedConfigName) {
    return DASHBOARD_CONFIGS;
  }

  const selectedConfig = DASHBOARD_CONFIG_LOOKUP[selectedConfigName as keyof typeof DASHBOARD_CONFIG_LOOKUP];

  if (!selectedConfig) {
    logger.error(
      `Unknown DASHBOARD_CONFIG_NAME '${selectedConfigName}'. Expected one of: ${Object.keys(DASHBOARD_CONFIG_LOOKUP).join(", ")}.`
    );
    process.exit(1);
  }

  return [selectedConfig];
}

function requireApiKey(providerId: string): string {
  const apiKey = resolveApiKey(providerId);

  if (!apiKey || apiKey.startsWith("YOUR_")) {
    if (providerId.toLowerCase() === PROVIDER_IDS.FMP) {
      logger.error("Missing FinancialModelingPrep API key. Set FMP_API_KEY in environment or update src/constants.ts.");
    } else if (providerId.toLowerCase() === PROVIDER_IDS.ALPHA_VANTAGE || providerId.toLowerCase() === "alphavantage" || providerId.toLowerCase() === "alpha_vantage") {
      logger.error("Missing Alpha Vantage API key. Set ALPHA_VANTAGE_API_KEY in environment or update src/constants.ts.");
    } else if (providerId.toLowerCase() === PROVIDER_IDS.TIINGO) {
      logger.error("Missing Tiingo API key. Set TIINGO_API_KEY in environment or update src/constants.ts.");
    } else {
      logger.error(`Missing API key for provider '${providerId}'.`);
    }
    process.exit(1);
  }

  return apiKey;
}

function createSheetsClient(): GoogleSheetsClient | null {
  const spreadsheetId = process.env.SPREADSHEET_ID || CONSTANTS.SPREADSHEET_ID;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const serviceAccountCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  logger.info("Initializing Google Sheets integration.", {
    spreadsheetId: spreadsheetId || "<none>",
    credentialSource: serviceAccountKey ? "GOOGLE_SERVICE_ACCOUNT_KEY" : serviceAccountCredentialsPath ? "GOOGLE_APPLICATION_CREDENTIALS" : "none"
  });

  if (!spreadsheetId || spreadsheetId === "YOUR_SPREADSHEET_ID") {
    logger.warn("Google Sheets integration disabled: SPREADSHEET_ID is not configured.");
    return null;
  }

  if (!serviceAccountKey && !serviceAccountCredentialsPath) {
    logger.warn("SPREADSHEET_ID is configured, but no Google service account credentials were found. Spreadsheet writes will be skipped.");
    return null;
  }

  return new GoogleSheetsClient({
    spreadsheetId,
    serviceAccountKey,
    serviceAccountCredentialsPath
  });
}

async function runDashboard(input: StockInputGroup): Promise<void> {
  const providerId = resolveProviderId(input);
  const apiKey = requireApiKey(providerId);
  const provider = createProvider(providerId, { apiKey });
  const processor = new DashboardProcessor(provider);

  logger.info(`Generating dashboard: ${input.TARGET_SHEET_NAME} (provider=${provider.id})`);
  const result = await processor.generateDashboard(input, { writeJson: false });
  logger.info(`Generated dashboard rows in memory for ${input.TARGET_SHEET_NAME}.`);

  if (!sheetClient) {
    logger.info("Sheet client not configured; skipping spreadsheet write.");
    return;
  }

  logger.info(`Writing ${result.rows.length} rows to spreadsheet sheet: ${input.TARGET_SHEET_NAME}`);
  await sheetClient.writeSheet(
    input.TARGET_SHEET_NAME,
    COLUMN_CONFIG.map(col => col.header),
    result.rows,
    COLUMN_CONFIG.map(col => col.format),
    result.errors,
    result.notes,
    { providerId: provider.id }
  );
  logger.info(`Wrote spreadsheet sheet: ${input.TARGET_SHEET_NAME}`);
}

async function main(): Promise<void> {
  try {
    for (const group of resolveDashboardConfigs()) {
      await runDashboard(group);
    }
    logger.info("Stock scanner finished successfully.");
  } catch (error) {
    logger.error("Stock scanner failed:", error);
    process.exit(1);
  }
}

void main();
