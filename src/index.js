import { CONSTANTS, STOCKS_AI, STOCKS_OTHER } from "./constants.js";
import { DashboardProcessor, FmpApiClient, COLUMN_CONFIG } from "./fmp.js";
import { GoogleSheetsClient } from "./sheets.js";
import { logger } from "./logger.js";

const envKeys = [process.env.FMP_API_KEYS, process.env.FMP_API_KEY]
  .flatMap(value => {
    if (!value) return [];
    return String(value)
      .split(",")
      .map(key => key.trim())
      .filter(Boolean);
  });
const apiKeys = envKeys.length ? envKeys : (Array.isArray(CONSTANTS.FMP_API_KEYS) ? CONSTANTS.FMP_API_KEYS : [CONSTANTS.FMP_API_KEYS]).filter(Boolean);

if (!apiKeys.length || apiKeys[0] === "YOUR_FMP_API_KEY") {
  logger.error("Missing FinancialModelingPrep API keys. Set FMP_API_KEY or FMP_API_KEYS in environment or update src/constants.js.");
  process.exit(1);
}

const sheetClient = createSheetsClient();

function createSheetsClient() {
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
    logger.warn(
      "SPREADSHEET_ID is configured, but no Google service account credentials were found. Spreadsheet writes will be skipped."
    );
    return null;
  }

  return new GoogleSheetsClient({
    spreadsheetId,
    serviceAccountKey,
    serviceAccountCredentialsPath
  });
}

async function runDashboard(input, fileName) {
  const client = new FmpApiClient(apiKeys);
  const processor = new DashboardProcessor(client);
  logger.info(`Generating dashboard: ${input.TARGET_SHEET_NAME}`);
  const result = await processor.generateDashboard(input, { writeJson: false });
  logger.info(`Generated dashboard rows in memory for ${input.TARGET_SHEET_NAME}.`);

  if (sheetClient) {
    logger.info(`Writing ${result.rows.length} rows to spreadsheet sheet: ${input.TARGET_SHEET_NAME}`);
    await sheetClient.writeSheet(
      input.TARGET_SHEET_NAME,
      COLUMN_CONFIG.map(col => col.header),
      result.rows,
      COLUMN_CONFIG.map(col => col.format),
      result.errors
    );
    logger.info(`Wrote spreadsheet sheet: ${input.TARGET_SHEET_NAME}`);
  } else {
    logger.info("Sheet client not configured; skipping spreadsheet write.");
  }
}

async function main() {
  try {
    //await runDashboard(STOCKS_AI, "dashboard-ai.json");
    await runDashboard(STOCKS_OTHER, "dashboard-other.json");
    logger.info("Stock scanner finished successfully.");
  } catch (error) {
    logger.error("Stock scanner failed:", error);
    process.exit(1);
  }
}

await main();
