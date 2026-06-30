import { PROVIDER_IDS } from "./provider";
import { StockInputGroup } from "./types";

const getEnvValue = (key: string, fallback = ""): string => {
  const value = process.env[key];
  return value && String(value).trim() ? String(value).trim() : fallback;
};

export const CONSTANTS = {
  FMP_API_KEY: getEnvValue("FMP_API_KEY", "YOUR_FMP_API_KEY"),
  ALPHA_VANTAGE_API_KEY: getEnvValue("ALPHA_VANTAGE_API_KEY", "YOUR_ALPHA_VANTAGE_API_KEY"),
  SPREADSHEET_ID: getEnvValue("SPREADSHEET_ID", "YOUR_SPREADSHEET_ID")
};

export const STOCKS_AI: StockInputGroup = {
  TARGET_SHEET_NAME: "FIN_DASHBOARD_AV",
  DATA_PROVIDER: PROVIDER_IDS.ALPHA_VANTAGE,
  INPUT_DATA: [
    { symbol: "AVAV", industry: "Defense" }
  ]
};

export const STOCKS_OTHER: StockInputGroup = {
  TARGET_SHEET_NAME: "FIN_DASHBOARD_FMP",
  DATA_PROVIDER: PROVIDER_IDS.FMP,
  INPUT_DATA: [
    { symbol: "AVAV", industry: "Defense" }
  ]
};

export const DASHBOARD_CONFIGS: StockInputGroup[] = [STOCKS_AI, STOCKS_OTHER];
