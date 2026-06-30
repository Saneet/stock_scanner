import { CONSTANTS, STOCKS_AI, STOCKS_OTHER } from "./constants";
import { DashboardProcessor } from "./dashboard";
import { COLUMN_CONFIG } from "./metrics";
import { createProvider } from "./provider";
import { logger } from "./logger";
import { GoogleSheetsClient } from "./sheets";
import { StockInputGroup } from "./types";

const apiKeys = [process.env.FMP_API_KEYS, process.env.FMP_API_KEY]
  .flatMap(value => (value ? String(value).split(",") : []))
  .map(key => key.trim())
  .filter(Boolean);

const resolvedApiKeys = apiKeys.length > 0 ? apiKeys : CONSTANTS.FMP_API_KEYS.filter(Boolean);

if (CONSTANTS.DATA_PROVIDER.toLowerCase() === "fmp") {
  if (!resolvedApiKeys.length || resolvedApiKeys[0] === "YOUR_FMP_API_KEY") {
    logger.error("Missing FinancialModelingPrep API keys. Set FMP_API_KEY or FMP_API_KEYS in environment or update src/constants.ts.");
    process.exit(1);
  }
}

const sheetClient = createSheetsClient();

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
  const provider = createProvider(CONSTANTS.DATA_PROVIDER, { apiKeys: resolvedApiKeys });
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
    result.errors
  );
  logger.info(`Wrote spreadsheet sheet: ${input.TARGET_SHEET_NAME}`);
}

async function main(): Promise<void> {
  try {
    // await runDashboard(STOCKS_AI);
    await runDashboard(STOCKS_OTHER);
    logger.info("Stock scanner finished successfully.");
  } catch (error) {
    logger.error("Stock scanner failed:", error);
    process.exit(1);
  }
}

void main();
