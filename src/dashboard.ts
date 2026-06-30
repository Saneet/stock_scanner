import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { COLUMN_CONFIG, MetricsCalculator } from "./metrics";
import { DashboardDataset, MarketDataProvider, RawTickerData, StockInputGroup } from "./types";

export class DataFetcher {
  constructor(private readonly provider: MarketDataProvider) {}

  async fetchAll(inputList: StockInputGroup["INPUT_DATA"], errorLog: string[]): Promise<Record<string, RawTickerData>> {
    logger.info(`Fetching data for ${inputList.length} tickers using provider '${this.provider.id}'.`);
    const dataset: Record<string, RawTickerData> = {};

    for (const input of inputList) {
      const ticker = input.symbol;
      if (!ticker) continue;
      logger.info(`Fetching ticker data: ${ticker}`);

      const batch = await this.provider.fetchTickerDataBatch(ticker);
      if (batch.incomeAnnual.length === 0 && !batch.profile) {
        const message = `[${ticker}] No API data found or limit hit.`;
        errorLog.push(message);
        logger.warn(message);
      }

      dataset[ticker] = {
        ticker: input.symbol,
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

  async generateDashboard(input: StockInputGroup, options: { outputPath?: string; writeJson?: boolean } = {}): Promise<DashboardDataset> {
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

    return result;
  }
}
