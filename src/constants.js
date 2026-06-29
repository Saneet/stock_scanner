const getEnvValue = (key, fallback = "") => {
  const value = process.env[key];
  return value && String(value).trim() ? String(value).trim() : fallback;
};

const parseEnvList = (key, fallback = []) => {
  const raw = getEnvValue(key);
  if (!raw) return fallback;
  return raw.split(",").map(value => value.trim()).filter(Boolean);
};

export const CONSTANTS = {
  FMP_API_KEYS: parseEnvList("FMP_API_KEYS", parseEnvList("FMP_API_KEY", ["YOUR_FMP_API_KEY"])),
  SPREADSHEET_ID: getEnvValue("SPREADSHEET_ID", "YOUR_SPREADSHEET_ID"),
  ALPHA_VANTAGE_API_KEY: getEnvValue("ALPHA_VANTAGE_API_KEY", "YOUR_ALPHA_VANTAGE_API_KEY")
};

export const STOCKS_AI = {
  TARGET_SHEET_NAME: "FIN_DASHBOARD_AI",
  INPUT_DATA: [
    { symbol: "CRWV", industry: "AI Cloud" }
  ]
};

export const STOCKS_OTHER = {
  TARGET_SHEET_NAME: "FIN_DASHBOARD_OTHER",
  INPUT_DATA: [
    { symbol: "AVAV", industry: "Defense" }
  ]
};
