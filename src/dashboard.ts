import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { COLUMN_CONFIG, MetricsCalculator } from "./metrics";
import { PROVIDER_IDS } from "./provider";
import { toApiTicker, toSheetTicker } from "./ticker";
import { DashboardDataset, DashboardRunResult, MarketDataProvider, NormalizedTickerBatch, RawTickerData, StockInputGroup } from "./types";

interface MissingFieldCheck {
  label: string;
  isMissing: (batch: NormalizedTickerBatch) => boolean;
}

interface RecordFieldCheck {
  label: string;
  isMissing: (value: Record<string, unknown>) => boolean;
}

const PROVIDER_MISSING_FIELD_CHECKS: Record<string, MissingFieldCheck[]> = {
  [PROVIDER_IDS.FMP]: [
    { label: "profile.price", isMissing: batch => batch.profile?.price === undefined || batch.profile?.price === null },
    { label: "priceChange.5D", isMissing: batch => batch.priceChange?.["5D"] === undefined || batch.priceChange?.["5D"] === null },
    { label: "priceChange.1M", isMissing: batch => batch.priceChange?.["1M"] === undefined || batch.priceChange?.["1M"] === null },
    { label: "priceChange.3M", isMissing: batch => batch.priceChange?.["3M"] === undefined || batch.priceChange?.["3M"] === null },
    { label: "priceChange.1Y", isMissing: batch => batch.priceChange?.["1Y"] === undefined || batch.priceChange?.["1Y"] === null },
    { label: "profile.companyName", isMissing: batch => isMissingString(batch.profile?.companyName) },
    { label: "profile.ceo", isMissing: batch => isMissingString(batch.profile?.ceo) },
    { label: "profile.country", isMissing: batch => isMissingString(batch.profile?.country) },
    { label: "profile.isAdr", isMissing: batch => batch.profile?.isAdr === undefined },
    { label: "profile.marketCap", isMissing: batch => batch.profile?.marketCap === undefined || batch.profile?.marketCap === null },
    { label: "ratios.priceToSalesRatioTTM", isMissing: batch => batch.ratios?.priceToSalesRatioTTM === undefined || batch.ratios?.priceToSalesRatioTTM === null },
    { label: "ratios.priceToEarningsRatioTTM", isMissing: batch => batch.ratios?.priceToEarningsRatioTTM === undefined || batch.ratios?.priceToEarningsRatioTTM === null }
  ],
  [PROVIDER_IDS.ALPHA_VANTAGE]: [
    { label: "profile.companyName", isMissing: batch => isMissingString(batch.profile?.companyName) },
    { label: "profile.country", isMissing: batch => isMissingString(batch.profile?.country) },
    { label: "profile.marketCap", isMissing: batch => batch.profile?.marketCap === undefined || batch.profile?.marketCap === null },
    { label: "ratios.priceToSalesRatioTTM", isMissing: batch => batch.ratios?.priceToSalesRatioTTM === undefined || batch.ratios?.priceToSalesRatioTTM === null },
    { label: "ratios.priceToEarningsRatioTTM", isMissing: batch => batch.ratios?.priceToEarningsRatioTTM === undefined || batch.ratios?.priceToEarningsRatioTTM === null }
  ],
  [PROVIDER_IDS.TIINGO]: [
    { label: "profile.companyName", isMissing: batch => isMissingString(batch.profile?.companyName) },
    { label: "profile.country", isMissing: batch => isMissingString(batch.profile?.country) },
    { label: "profile.isAdr", isMissing: batch => batch.profile?.isAdr === undefined },
    { label: "profile.marketCap", isMissing: batch => batch.profile?.marketCap === undefined || batch.profile?.marketCap === null },
    { label: "ratios.priceToEarningsRatioTTM", isMissing: batch => batch.ratios?.priceToEarningsRatioTTM === undefined || batch.ratios?.priceToEarningsRatioTTM === null }
  ]
};

const ALL_PROVIDER_RECORD_CHECKS: Record<string, RecordFieldCheck[]> = {
  incomeAnnual: [
    { label: "revenue", isMissing: record => isMissingNumber(getRecordField(record, "revenue")) },
    { label: "grossProfit", isMissing: record => isMissingNumber(getRecordField(record, "grossProfit")) }
  ],
  incomeQuarterly: [
    { label: "revenue", isMissing: record => isMissingNumber(getRecordField(record, "revenue")) },
    { label: "grossProfit", isMissing: record => isMissingNumber(getRecordField(record, "grossProfit")) }
  ],
  cashFlow: [
    { label: "operatingCashFlow", isMissing: record => isMissingNumber(getRecordField(record, "operatingCashFlow")) },
    { label: "capitalExpenditure", isMissing: record => isMissingNumber(getRecordField(record, "capitalExpenditure")) }
  ]
};

function isMissingString(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function isMissingNumber(value: number | string | undefined | null): boolean {
  return value === undefined || value === null || value === "";
}

function getRecordField(record: Record<string, unknown>, key: string): number | string | undefined | null {
  const value = record[key];
  if (typeof value === "number" || typeof value === "string") return value;
  if (value === undefined || value === null) return value;
  return undefined;
}

function getMissingRecordFields(records: Array<Record<string, unknown>>, checks: RecordFieldCheck[]): string[] {
  const missingFields = new Set<string>();

  for (const record of records) {
    for (const check of checks) {
      if (check.isMissing(record)) {
        missingFields.add(check.label);
      }
    }
  }

  return Array.from(missingFields);
}

function getMissingProviderFields(providerId: string, batch: NormalizedTickerBatch): string[] {
  const missingFields: string[] = [];

  if (batch.incomeAnnual.length === 0) missingFields.push("incomeAnnual");
  if (batch.incomeQuarterly.length === 0) missingFields.push("incomeQuarterly");
  if (batch.cashFlow.length === 0) missingFields.push("cashFlow");
  if (!batch.profile) missingFields.push("profile");
  if (!batch.ratios) missingFields.push("ratios");
  if (!batch.priceChange && providerId.toLowerCase() === PROVIDER_IDS.FMP) missingFields.push("priceChange");

  missingFields.push(...getMissingRecordFields(batch.incomeAnnual as Array<Record<string, unknown>>, ALL_PROVIDER_RECORD_CHECKS.incomeAnnual).map(field => `incomeAnnual.${field}`));
  missingFields.push(...getMissingRecordFields(batch.incomeQuarterly as Array<Record<string, unknown>>, ALL_PROVIDER_RECORD_CHECKS.incomeQuarterly).map(field => `incomeQuarterly.${field}`));
  missingFields.push(...getMissingRecordFields(batch.cashFlow as Array<Record<string, unknown>>, ALL_PROVIDER_RECORD_CHECKS.cashFlow).map(field => `cashFlow.${field}`));

  if (batch.profile) {
    const checks = PROVIDER_MISSING_FIELD_CHECKS[providerId.toLowerCase()] ?? [];
    for (const check of checks) {
      if (check.isMissing(batch)) {
        missingFields.push(check.label);
      }
    }
  }

  return missingFields;
}

export class DataFetcher {
  constructor(private readonly provider: MarketDataProvider) {}

  async fetchAll(inputList: StockInputGroup["INPUT_DATA"], errorLog: string[]): Promise<Record<string, RawTickerData>> {
    logger.info(`Fetching data for ${inputList.length} tickers using provider '${this.provider.id}'.`);
    const dataset: Record<string, RawTickerData> = {};

    for (const input of inputList) {
      const ticker = input.symbol;
      if (!ticker) continue;
      const apiTicker = toApiTicker(ticker);
      const sheetTicker = toSheetTicker(ticker);
      logger.info(`Fetching ticker data: ${ticker}${apiTicker !== ticker ? ` -> ${apiTicker}` : ""}`);

      const batch = await this.provider.fetchTickerDataBatch(apiTicker);
      const missingFields = getMissingProviderFields(this.provider.id, batch);
      if (missingFields.length > 0) {
        const message = `[${ticker}] Missing expected ${this.provider.id} data: ${missingFields.join(", ")}`;
        errorLog.push(message);
        logger.warn(message);
      }

      dataset[ticker] = {
        ticker: sheetTicker,
        industry: input.industry,
        incomeAnnual: batch.incomeAnnual,
        incomeQuarterly: batch.incomeQuarterly,
        cashFlow: batch.cashFlow,
        profile: batch.profile,
        ratios: batch.ratios,
        priceChange: batch.priceChange
      };
    }

    logger.info("Completed data fetch for all tickers.");
    return dataset;
  }
}

export class OutputWriter {
  static writeJson(filename: string, payload: DashboardDataset): void {
    const fullPath = path.resolve(filename);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), "utf8");
  }
}

export class DashboardProcessor {
  private readonly fetcher: DataFetcher;
  private readonly errors: string[] = [];

  constructor(provider: MarketDataProvider) {
    this.fetcher = new DataFetcher(provider);
  }

  async generateDashboard(input: StockInputGroup, options: { outputPath?: string; writeJson?: boolean } = {}): Promise<DashboardRunResult> {
    const { outputPath, writeJson = true } = options;
    logger.info(`Generating dashboard dataset for sheet: ${input.TARGET_SHEET_NAME}`);
    const rawDataMap = await this.fetcher.fetchAll(input.INPUT_DATA, this.errors);
    const rows: DashboardDataset["rows"] = [];
    const notes: DashboardDataset["notes"] = [];

    for (const inputItem of input.INPUT_DATA) {
      const data = rawDataMap[inputItem.symbol];
      if (!data) {
        logger.warn(`No raw data found for ticker ${inputItem.symbol}; skipping row generation.`);
        continue;
      }
      const metrics = MetricsCalculator.calculateAll(data);
      rows.push(COLUMN_CONFIG.map(col => col.getValue(metrics)));
      notes.push(COLUMN_CONFIG.map(col => col.getNote(metrics)));
      logger.debug(`Generated row for ${inputItem.symbol}`);
    }

    const result: DashboardDataset = {
      targetSheetName: input.TARGET_SHEET_NAME,
      generatedAt: new Date().toISOString(),
      columns: COLUMN_CONFIG.map(col => ({ header: col.header, note: col.note, format: col.format })),
      rows,
      notes,
      errors: [...this.errors]
    };

    if (writeJson && outputPath) {
      OutputWriter.writeJson(outputPath, result);
    }

    return {
      ...result,
      rawDataByTicker: rawDataMap
    };
  }
}
