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
    if (existingSheet) {
      // Find and delete any existing banding styles on this sheet first to prevent conflicts during formatting.
      // bandedRanges lives directly on the Sheet object
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
        } catch (err) {
          logger.warn(`Could not pre-delete banding on sheet ${sheetName}: ${err.message}`);
        }
      }
      return existingSheet.properties.sheetId;
    }

    const result = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });

    return result.data.replies?.[0]?.addSheet?.properties?.sheetId;
  }

  async clearSheet(sheetName, sheetId) {
    const sheets = await this.getSheetsApi();

    // Clear all cell content (values, formatting, notes, etc.) and sheet state
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            // fields: "*" clears every cell field: values, formatting, notes, data validation, etc.
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

  async writeSheet(sheetName, headers, rows, columnFormats = [], errors = []) {
    if (!Array.isArray(headers) || headers.length === 0) {
      throw new Error("GoogleSheetsClient.writeSheet requires a non-empty headers array.");
    }

    const sheetId = await this.ensureSheet(sheetName);
    await this.clearSheet(sheetName, sheetId);
    const sheets = await this.getSheetsApi();
    const values = [headers, ...rows];
    const range = `${sheetName}!A1`;

    // Write values
    const valueResponse = await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
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

    // Write errors at the bottom of the sheet as in previous version
    const errorStartRow = rows.length + 4; // DATA_START_ROW + total rows + 2 context rows
    const logText = Array.isArray(errors) && errors.length > 0 ? errors.join("\n") : "No errors or warnings.";
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A${errorStartRow}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Errors & Warnings:\n" + logText]]
      }
    });

    // Format the error block to be bold/red/gray via format requests (or optionally just leave formatting as is)
    // Note: To get precise styling for errors, we can add a text format request in applyFormatting or handle it here,
    // but the simplest and most robust way that mimics the original and avoids merge conflicts is applying formatting.

    // Apply formatting
    await this.applyFormatting(sheetId, headers, rows, columnFormats, errorStartRow, Array.isArray(errors) && errors.length > 0);
  }

  async applyFormatting(sheetId, headers, rows, columnFormats = [], errorStartRow = null, hasErrors = false) {
    const sheets = await this.getSheetsApi();
    const requests = [];
    const numColumns = headers.length;
    const numRows = Array.isArray(rows) ? rows.length : 0;
    const totalRows = numRows + 1; // +1 for header

    // 1. Bold headers
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

    // 2. Apply number formats per column
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

    // 4. Freeze first row and first column
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

    // 5. Add alternating row colors (banding)
    requests.push({
      addBanding: {
        bandedRange: {
          // Assign a stable bandedRangeId (use sheetId) so repeated runs update
          // the existing banding instead of creating duplicates.
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

    // 6. Resize columns using the current data, capped to keep wide columns readable.
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
          properties: {
            pixelSize
          },
          fields: "pixelSize"
        }
      });
    });

    const wrapColumns = columnSizing.filter(column => column.wrap).map(column => column.index);

    if (wrapColumns.length > 0) {
      wrapColumns.forEach(col => {
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
      });
    }

    // Clear existing filter before setting a new one (prevents crashes on re-runs)
    requests.push({
      clearBasicFilter: {
        sheetId: sheetId
      }
    });

    // 7. Create filter
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

    // 8. Error log block formatting (if errorStartRow is provided)
    if (errorStartRow !== null) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: errorStartRow - 1,
            endRowIndex: errorStartRow,
            startColumnIndex: 0,
            endColumnIndex: 10 // wrap/format first 10 columns for the error block safely
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

    // Execute all formatting requests
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

  getNumberFormat(format) {
    const formats = {
      currency: { type: "CURRENCY", pattern: "$#,##0.00" },
      percent: { type: "PERCENT", pattern: "0.00%" },
      // Custom large currencies fall under standard NUMBER types
      large_currency: { type: "NUMBER", pattern: '[>=1000000000000]0.00,,,"T";[>=1000000000]0.00,,"B";0.00,,"M"' },
      number: { type: "NUMBER", pattern: "0.00" },
      string: null
    };

    return formats[format] || null;
  }

  calculateColumnSizing(headers, rows, columnFormats = []) {
    const minWidth = 80;
    const maxWidth = 300;
    const padding = 15;

    return headers.map((header, index) => {
      const format = columnFormats[index] || "string";
      const values = [header, ...(Array.isArray(rows) ? rows.map(row => row?.[index]) : [])];
      const longestDisplayLength = values.reduce((longest, value) => {
        const displayValue = this.getDisplayValue(value, format);
        return Math.max(longest, this.estimateTextWidth(displayValue));
      }, 0);

      const estimatedWidth = Math.ceil(longestDisplayLength + padding);
      const pixelSize = Math.max(minWidth, Math.min(maxWidth, estimatedWidth));
      const wrap = format === "string" && estimatedWidth > maxWidth;

      return {
        index,
        pixelSize,
        wrap
      };
    });
  }

  getDisplayValue(value, format) {
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
          if (absoluteValue >= 1_000_000_000_000) {
            return `${(value / 1_000_000_000_000).toFixed(2)}T`;
          }
          if (absoluteValue >= 1_000_000_000) {
            return `${(value / 1_000_000_000).toFixed(2)}B`;
          }
          if (absoluteValue >= 1_000_000) {
            return `${(value / 1_000_000).toFixed(2)}M`;
          }
          return new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(value);
        }
        case "number":
        default:
          return new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(value);
      }
    }

    if (value instanceof Date) {
      return value.toLocaleString("en-US");
    }

    return String(value);
  }

  estimateTextWidth(value) {
    if (!value) {
      return 0;
    }

    const lineWidths = String(value)
      .split(/\r?\n/)
      .map(line => this.estimateSingleLineWidth(line));

    return lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
  }

  estimateSingleLineWidth(line) {
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
      } else if (character >= "ა" && character <= "ჿ") {
        width += 10;
      } else {
        width += 7;
      }
    }

    return width;
  }
}
