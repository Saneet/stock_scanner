import { logger } from "../logger";
import { IncomeStatementRecord, MarketDataProvider, NormalizedTickerBatch } from "../types";

export class FmpProvider implements MarketDataProvider {
  readonly id = "fmp";

  private readonly apiKey: string;
  private lastRequestTime = 0;
  private readonly baseUrl = "https://financialmodelingprep.com/stable";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("FMP provider requires an API key.");
    }
    this.apiKey = apiKey;
  }

  private getApiKey(): string {
    return this.apiKey;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timePassed = now - this.lastRequestTime;
    const requiredDelay = 200; // 300 calls/min → 60,000 / 300 = 200ms
    if (timePassed < requiredDelay) {
      await this.delay(requiredDelay - timePassed);
    }
    this.lastRequestTime = Date.now();
  }

  private async fetchJson(url: string, retries = 3): Promise<unknown> {
    logger.debug(`Fetching URL: ${url}`);
    await this.enforceRateLimit();

    const response = await fetch(url);
    const text = await response.text();
    logger.debug(`Received HTTP ${response.status} for ${url}`);

    const isRateLimited = response.status === 429 || text.includes("Limit Reach");
    if (isRateLimited && retries > 0) {
      logger.warn(`API rate limit or error response detected for ${url}. Retrying after delay.`);
      await this.delay(2000);
      return this.fetchJson(url, retries - 1);
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      logger.error(`Failed to parse JSON response from ${url}:`, error);
      return null;
    }
  }

  async fetchTickerDataBatch(ticker: string): Promise<NormalizedTickerBatch> {
    const key = this.getApiKey();
    const endpoints = [
      `${this.baseUrl}/income-statement?symbol=${ticker}&limit=5&apikey=${key}`,
      `${this.baseUrl}/income-statement?symbol=${ticker}&period=quarter&limit=10&apikey=${key}`,
      `${this.baseUrl}/cash-flow-statement?symbol=${ticker}&limit=2&apikey=${key}`,
      `${this.baseUrl}/profile?symbol=${ticker}&apikey=${key}`,
      `${this.baseUrl}/ratios-ttm?symbol=${ticker}&apikey=${key}`,
      `${this.baseUrl}/stock-price-change?symbol=${ticker}&apikey=${key}`
    ];

    const responses: Record<string, unknown> = {};
    for (const endpoint of endpoints) {
      responses[endpoint] = await this.fetchJson(endpoint);
    }

    const incomeAnnual = this.toObjectArray(responses[endpoints[0]]).map(record => this.mapIncomeRecord(record, false));
    const incomeQuarterly = this.toObjectArray(responses[endpoints[1]]).map(record => this.mapIncomeRecord(record, true));
    const cashFlow = this.toObjectArray(responses[endpoints[2]]);
    const profileRaw = this.toObjectArray(responses[endpoints[3]]);
    const ratiosRaw = this.toObjectArray(responses[endpoints[4]]);
    const priceChangeRaw = this.toObjectArray(responses[endpoints[5]]);

    return {
      incomeAnnual,
      incomeQuarterly,
      cashFlow,
      profile: (profileRaw[0] as NormalizedTickerBatch["profile"]) ?? null,
      ratios: (ratiosRaw[0] as NormalizedTickerBatch["ratios"]) ?? null,
      priceChange: (priceChangeRaw[0] as NormalizedTickerBatch["priceChange"]) ?? null
    };
  }

  private toObjectArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  private mapIncomeRecord(record: Record<string, unknown>, includeGrossProfit: boolean): IncomeStatementRecord {
    const mapped: IncomeStatementRecord = {
      date: typeof record.fiscalDateEnding === "string" ? record.fiscalDateEnding : undefined,
      revenue: this.toNumber(record.totalRevenue)
    };

    if (includeGrossProfit) {
      mapped.grossProfit = this.toNumber(record.grossProfit);
    }

    return mapped;
  }

  private toNumber(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
