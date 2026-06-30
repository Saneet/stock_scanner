import fs from "node:fs";
import path from "node:path";
import { google, sheets_v4 } from "googleapis";
import { logger } from "./logger";
import { CellValue, ColumnFormat } from "./types";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

interface GoogleSheetsClientConfig {
  spreadsheetId?: string;
  serviceAccountKey?: string | Record<string, unknown>;
  serviceAccountCredentialsPath?: string;
}

export class GoogleSheetsClient {
  private readonly spreadsheetId: string;
  private readonly serviceAccountKey?: string | Record<string, unknown>;
  private readonly serviceAccountCredentialsPath?: string;
  private authClient?: unknown;
  private sheetsApi?: sheets_v4.Sheets;

  constructor({ spreadsheetId, serviceAccountKey, serviceAccountCredentialsPath }: GoogleSheetsClientConfig = {}) {
    this.spreadsheetId = spreadsheetId ?? "";
    this.serviceAccountKey = serviceAccountKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    this.serviceAccountCredentialsPath = serviceAccountCredentialsPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!this.spreadsheetId || this.spreadsheetId === "YOUR_SPREADSHEET_ID") {
      throw new Error("Missing SPREADSHEET_ID. Set SPREADSHEET_ID in environment or src/constants.ts.");
    }

    if (!this.serviceAccountKey && !this.serviceAccountCredentialsPath) {
      throw new Error("Missing Google service account credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.");
    }
  }

  private getCredentials(): Record<string, unknown> {
    if (this.serviceAccountKey) {
      if (typeof this.serviceAccountKey === "string") {
        try {
          return JSON.parse(this.serviceAccountKey) as Record<string, unknown>;
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
      return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as Record<string, unknown>;
    }

    throw new Error("Google service account credentials are required.");
  }

  private async getAuthClient() {
    if (this.authClient) return this.authClient;

    const auth = new google.auth.GoogleAuth({
      credentials: this.getCredentials(),
      scopes: SCOPES
    });

    this.authClient = await auth.getClient();
    return this.authClient;
  }

  private async getSheetsApi(): Promise<sheets_v4.Sheets> {
    if (this.sheetsApi) return this.sheetsApi;
    const auth = await this.getAuthClient();
    this.sheetsApi = google.sheets({ version: "v4", auth: auth as never });
    return this.sheetsApi;
  }

  private async ensureSheet(sheetName: string): Promise<number> {
    const sheets = await this.getSheetsApi();
    const response = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const existingSheet = response.data.sheets?.find(sheet => sheet.properties?.title === sheetName);

    if (existingSheet) {
      const bandedRanges = existingSheet.bandedRanges || [];
      if (bandedRanges.length > 0) {
        const deleteRequests = bandedRanges.map(br => ({
          deleteBanding: { bandedRangeId: br.bandedRangeId }
        }));

        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: { requests: deleteRequests }
          });
          logger.info(`Deleted ${deleteRequests.length} existing banding ranges on sheet ${sheetName}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(`Could not pre-delete banding on sheet ${sheetName}: ${message}`);
        }
      }

      if (existingSheet.properties?.sheetId === undefined || existingSheet.properties.sheetId === null) {
        throw new Error(`Sheet '${sheetName}' exists but has no sheetId.`);
      }
      return existingSheet.properties.sheetId;
    }

    const result = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });

    const newSheetId = result.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (newSheetId === undefined || newSheetId === null) {
      throw new Error(`Failed to create sheet '${sheetName}'.`);
    }
    return newSheetId;
  }

  private async clearSheet(sheetName: string, sheetId: number): Promise<void> {
    const sheets = await this.getSheetsApi();

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 10000,
                startColumnIndex: 0,
                endColumnIndex: 50
              },
              cell: {},
              fields: "*"
            }
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 }
              },
              fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"
            }
          },
          {
            clearBasicFilter: { sheetId }
          }
        ]
      }
    });

    logger.info(`Cleared sheet: ${sheetName}`);
  }

  async writeSheet(
    sheetName: string,
    headers: string[],
    rows: CellValue[][],
    columnFormats: ColumnFormat[] = [],
    errors: string[] = []
  ): Promise<void> {
    if (!Array.isArray(headers) || headers.length === 0) {
      throw new Error("GoogleSheetsClient.writeSheet requires a non-empty headers array.");
    }

    const sheetId = await this.ensureSheet(sheetName);
    await this.clearSheet(sheetName, sheetId);

    const sheets = await this.getSheetsApi();
    const values = [headers, ...rows];

    const valueResponse = await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values }
    });

    logger.info("Google Sheets update response:", {
      status: valueResponse.status,
      statusText: valueResponse.statusText,
      updatedRange: valueResponse.data.updatedRange,
      updatedRows: valueResponse.data.updatedRows,
      updatedColumns: valueResponse.data.updatedColumns,
      totalUpdatedCells: valueResponse.data.updatedCells
    });

    const errorStartRow = rows.length + 4;
    const logText = errors.length > 0 ? errors.join("\n") : "No errors or warnings.";

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A${errorStartRow}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[`Errors & Warnings:\n${logText}`]]
      }
    });

    await this.applyFormatting(sheetId, headers, rows, columnFormats, errorStartRow, errors.length > 0);
  }

  private async applyFormatting(
    sheetId: number,
    headers: string[],
    rows: CellValue[][],
    columnFormats: ColumnFormat[] = [],
    errorStartRow: number | null = null,
    hasErrors = false
  ): Promise<void> {
    const sheets = await this.getSheetsApi();
    const requests: sheets_v4.Schema$Request[] = [];
    const numColumns = headers.length;
    const numRows = rows.length;
    const totalRows = numRows + 1;

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: numColumns
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true }
          }
        },
        fields: "userEnteredFormat.textFormat.bold"
      }
    });

    for (let col = 0; col < numColumns; col++) {
      const format = columnFormats[col] || "string";
      const numberFormat = this.getNumberFormat(format);
      if (numberFormat) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: totalRows,
              startColumnIndex: col,
              endColumnIndex: col + 1
            },
            cell: {
              userEnteredFormat: { numberFormat }
            },
            fields: "userEnteredFormat.numberFormat"
          }
        });
      }
    }

    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
            frozenColumnCount: 1
          }
        },
        fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"
      }
    });

    requests.push({
      addBanding: {
        bandedRange: {
          bandedRangeId: sheetId,
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: totalRows,
            startColumnIndex: 0,
            endColumnIndex: numColumns
          },
          rowProperties: {
            headerColor: { red: 0.9, green: 0.9, blue: 0.9 },
            firstBandColor: { red: 1.0, green: 1.0, blue: 1.0 },
            secondBandColor: { red: 0.96, green: 0.96, blue: 0.96 }
          }
        }
      }
    });

    const columnSizing = this.calculateColumnSizing(headers, rows, columnFormats);
    columnSizing.forEach(({ index, pixelSize }) => {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: index,
            endIndex: index + 1
          },
          properties: { pixelSize },
          fields: "pixelSize"
        }
      });
    });

    const wrapColumns = columnSizing.filter(column => column.wrap).map(column => column.index);
    for (const col of wrapColumns) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: totalRows,
            startColumnIndex: col,
            endColumnIndex: col + 1
          },
          cell: {
            userEnteredFormat: { wrapStrategy: "WRAP" }
          },
          fields: "userEnteredFormat.wrapStrategy"
        }
      });
    }

    requests.push({ clearBasicFilter: { sheetId } });
    requests.push({
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: totalRows,
            startColumnIndex: 0,
            endColumnIndex: numColumns
          }
        }
      }
    });

    if (errorStartRow !== null) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: errorStartRow - 1,
            endRowIndex: errorStartRow,
            startColumnIndex: 0,
            endColumnIndex: 10
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                bold: true,
                foregroundColor: hasErrors ? { red: 0.8, green: 0.0, blue: 0.0 } : { red: 0.5, green: 0.5, blue: 0.5 }
              }
            }
          },
          fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColor"
        }
      });
    }

    if (requests.length > 0) {
      const formatResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests }
      });

      logger.info("Formatting applied:", {
        replies: formatResponse.data.replies?.length || 0
      });
    }
  }

  private getNumberFormat(format: ColumnFormat): sheets_v4.Schema$NumberFormat | null {
    const formats: Record<ColumnFormat, sheets_v4.Schema$NumberFormat | null> = {
      currency: { type: "CURRENCY", pattern: "$#,##0.00" },
      percent: { type: "PERCENT", pattern: "0.00%" },
      large_currency: { type: "NUMBER", pattern: '[>=1000000000000]0.00,,,"T";[>=1000000000]0.00,,"B";0.00,,"M"' },
      number: { type: "NUMBER", pattern: "0.00" },
      string: null
    };

    return formats[format] || null;
  }

  private calculateColumnSizing(headers: string[], rows: CellValue[][], columnFormats: ColumnFormat[] = []) {
    const minWidth = 80;
    const maxWidth = 300;
    const padding = 15;

    return headers.map((header, index) => {
      const format = columnFormats[index] || "string";
      const values = [header, ...rows.map(row => row?.[index])];
      const longestDisplayLength = values.reduce<number>((longest, value) => {
        const displayValue = this.getDisplayValue(value, format);
        return Math.max(longest, this.estimateTextWidth(displayValue));
      }, 0);

      const estimatedWidth = Math.ceil(longestDisplayLength + padding);
      const pixelSize = Math.max(minWidth, Math.min(maxWidth, estimatedWidth));
      const wrap = format === "string" && estimatedWidth > maxWidth;

      return { index, pixelSize, wrap };
    });
  }

  private getDisplayValue(value: CellValue | undefined, format: ColumnFormat): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number") {
      switch (format) {
        case "currency":
          return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(value);
        case "percent":
          return new Intl.NumberFormat("en-US", {
            style: "percent",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(value);
        case "large_currency": {
          const absoluteValue = Math.abs(value);
          if (absoluteValue >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
          if (absoluteValue >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
          if (absoluteValue >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
          return new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(value);
        }
        case "number":
        case "string":
        default:
          return new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(value);
      }
    }

    return String(value);
  }

  private estimateTextWidth(value: string): number {
    if (!value) return 0;
    const lineWidths = String(value).split(/\r?\n/).map(line => this.estimateSingleLineWidth(line));
    return lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
  }

  private estimateSingleLineWidth(line: string): number {
    let width = 0;

    for (const character of line) {
      if (character === " ") {
        width += 4;
      } else if ("ilI1|!'.`.".includes(character)) {
        width += 4;
      } else if ("tfrj:;(),[]{}".includes(character)) {
        width += 6;
      } else if ("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$%&@#".includes(character)) {
        width += 8;
      } else {
        width += 7;
      }
    }

    return width;
  }
}
