import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { logger } from "./logger.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export class GoogleSheetsClient {
  constructor({ spreadsheetId, serviceAccountKey, serviceAccountCredentialsPath } = {}) {
    this.spreadsheetId = spreadsheetId;
    this.serviceAccountKey = serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    this.serviceAccountCredentialsPath = serviceAccountCredentialsPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!this.spreadsheetId || this.spreadsheetId === "YOUR_SPREADSHEET_ID") {
      throw new Error("Missing SPREADSHEET_ID. Set SPREADSHEET_ID in environment or src/constants.js.");
    }

    if (!this.serviceAccountKey && !this.serviceAccountCredentialsPath) {
      throw new Error("Missing Google service account credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.");
    }
  }

  getCredentials() {
    if (this.serviceAccountKey) {
      if (typeof this.serviceAccountKey === "string") {
        try {
          return JSON.parse(this.serviceAccountKey);
        } catch (error) {
          logger.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY. Ensure it is valid JSON.", error);
          throw error;
        }
      }
      return this.serviceAccountKey;
    }

    if (this.serviceAccountCredentialsPath) {
      const resolvedPath = path.resolve(this.serviceAccountCredentialsPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Google service account key file not found: ${resolvedPath}`);
      }
      return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    }

    throw new Error("Google service account credentials are required.");
  }

  async getAuthClient() {
    if (this.authClient) return this.authClient;

    const auth = new google.auth.GoogleAuth({
      credentials: this.getCredentials(),
      scopes: SCOPES
    });

    this.authClient = await auth.getClient();
    return this.authClient;
  }

  async getSheetsApi() {
    if (this.sheetsApi) return this.sheetsApi;
    const auth = await this.getAuthClient();
    this.sheetsApi = google.sheets({ version: "v4", auth });
    return this.sheetsApi;
  }

  async ensureSheet(sheetName) {
    const sheets = await this.getSheetsApi();
    const response = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const existingSheet = response.data.sheets?.find(sheet => sheet.properties?.title === sheetName);
    if (existingSheet) return existingSheet.properties.sheetId;

    const result = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });

    return result.data.replies?.[0]?.addSheet?.properties?.sheetId;
  }

  async writeSheet(sheetName, headers, rows) {
    if (!Array.isArray(headers) || headers.length === 0) {
      throw new Error("GoogleSheetsClient.writeSheet requires a non-empty headers array.");
    }

    await this.ensureSheet(sheetName);
    const sheets = await this.getSheetsApi();
    const values = [headers, ...rows];
    const range = `${sheetName}!A1`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values }
    });
  }
}
