import { logger } from "../logger";
import { CashFlowRecord, IncomeStatementRecord, MarketDataProvider, NormalizedTickerBatch, ProviderPriceChange, ProviderProfile, ProviderRatios } from "../types";

type AlphaVantageRecord = Record<string, unknown>;

interface DailyPriceEntry {
  date: string;
  close: number;
}

export class AlphaVantageProvider implements MarketDataProvider {
  readonly id = "alpha-vantage";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private lastRequestTime = 0;

  constructor(apiKey: string, baseUrl = "https://www.alphavantage.co/query") {
    if (!apiKey) {
      throw new Error("Alpha Vantage provider requires an API key.");
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
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
    const requiredDelay = 800; // 75 calls/min → 60,000 / 75 = 800ms

    if (timePassed < requiredDelay) {
      await this.delay(requiredDelay - timePassed);
    }

    this.lastRequestTime = Date.now();
  }

  private parseJson(text: string): unknown | null {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      logger.error("Failed to parse Alpha Vantage JSON response.", error);
      return null;
    }
  }

  private isThrottleResponse(text: string, parsed: unknown): boolean {
    const lowerText = text.toLowerCase();
    if (lowerText.includes("rate limit") || lowerText.includes("thank you for using alpha vantage")) {
      return true;
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as AlphaVantageRecord;
      const note = typeof record.Note === "string" ? record.Note.toLowerCase() : "";
      if (note.includes("api call frequency") || note.includes("premium endpoint")) {
        return true;
      }
    }

    return false;
  }

  private async fetchJson(url: string, retries = 3): Promise<unknown> {
    logger.debug(`Fetching Alpha Vantage URL: ${url}`);
    await this.enforceRateLimit();

    const response = await fetch(url);
    const text = await response.text();
    logger.debug(`Received HTTP ${response.status} for Alpha Vantage URL: ${url}`);

    const parsed = this.parseJson(text);
    if ((response.status === 429 || this.isThrottleResponse(text, parsed)) && retries > 0) {
      logger.warn(`Alpha Vantage throttled request for ${url}. Retrying after delay.`);
      await this.delay(5000);
      return this.fetchJson(url, retries - 1);
    }

    return parsed;
  }

  private toRecord(value: unknown): AlphaVantageRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as AlphaVantageRecord;
  }

  private toObjectArray(value: unknown): AlphaVantageRecord[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is AlphaVantageRecord => typeof item === "object" && item !== null && !Array.isArray(item));
  }

  private getString(record: AlphaVantageRecord | null, key: string): string | undefined {
    if (!record) return undefined;
    const value = record[key];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private getNumber(record: AlphaVantageRecord | null, key: string): number | undefined {
    if (!record) return undefined;
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private getBoolean(record: AlphaVantageRecord | null, key: string): boolean | undefined {
    if (!record) return undefined;
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value !== "string") return undefined;

    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
    return undefined;
  }

  private mapIncomeRecord(record: AlphaVantageRecord): IncomeStatementRecord {
    return {
      date: this.getString(record, "fiscalDateEnding"),
      revenue: this.getNumber(record, "totalRevenue"),
      grossProfit: this.getNumber(record, "grossProfit")
    };
  }

  private mapCashFlowRecord(record: AlphaVantageRecord): CashFlowRecord {
    return {
      operatingCashFlow: this.getNumber(record, "operatingCashflow") ?? this.getNumber(record, "operatingCashFlow"),
      capitalExpenditure: this.getNumber(record, "capitalExpenditures") ?? this.getNumber(record, "capitalExpenditure")
    };
  }

  private toDailyPriceEntries(seriesValue: unknown): DailyPriceEntry[] {
    if (!seriesValue || typeof seriesValue !== "object" || Array.isArray(seriesValue)) return [];

    const series = seriesValue as AlphaVantageRecord;
    return Object.keys(series)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())
      .map(date => {
        const dayRecord = this.toRecord(series[date]);
        const close = this.getNumber(dayRecord, "4. close") ?? this.getNumber(dayRecord, "5. adjusted close") ?? undefined;
        return close && close > 0 ? { date, close } : null;
      })
      .filter((entry): entry is DailyPriceEntry => entry !== null)
      .slice(0, 260);
  }

  private buildPriceChange(entries: DailyPriceEntry[], currentPrice: number): ProviderPriceChange | null {
    if (entries.length === 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;

    const windows: Array<[keyof ProviderPriceChange, number]> = [
      ["5D", 5],
      ["1M", 21],
      ["3M", 63],
      ["1Y", 252]
    ];

    const priceChange: ProviderPriceChange = {};
    for (const [key, index] of windows) {
      const priorEntry = entries[index];
      if (!priorEntry || !Number.isFinite(priorEntry.close) || priorEntry.close <= 0) continue;
      priceChange[key] = ((currentPrice - priorEntry.close) / priorEntry.close) * 100;
    }

    return Object.keys(priceChange).length > 0 ? priceChange : null;
  }

  async fetchTickerDataBatch(ticker: string): Promise<NormalizedTickerBatch> {
    const apiKey = this.getApiKey();
    const encodedTicker = encodeURIComponent(ticker);

    const incomeRaw = await this.fetchJson(`${this.baseUrl}?function=INCOME_STATEMENT&symbol=${encodedTicker}&apikey=${apiKey}`);
    const cashFlowRaw = await this.fetchJson(`${this.baseUrl}?function=CASH_FLOW&symbol=${encodedTicker}&apikey=${apiKey}`);
    const overviewRaw = await this.fetchJson(`${this.baseUrl}?function=OVERVIEW&symbol=${encodedTicker}&apikey=${apiKey}`);
    const quoteRaw = await this.fetchJson(`${this.baseUrl}?function=GLOBAL_QUOTE&symbol=${encodedTicker}&apikey=${apiKey}`);
    const dailyRaw = await this.fetchJson(`${this.baseUrl}?function=TIME_SERIES_DAILY&symbol=${encodedTicker}&outputsize=full&apikey=${apiKey}`);

    const incomeRecord = this.toRecord(incomeRaw);
    const cashFlowRecord = this.toRecord(cashFlowRaw);
    const overviewRecord = this.toRecord(overviewRaw);
    const quoteRecord = this.toRecord(quoteRaw);
    const dailyRecord = this.toRecord(dailyRaw);

    const incomeAnnual = this.toObjectArray(incomeRecord?.annualReports).slice(0, 4).map(record => this.mapIncomeRecord(record));
    const incomeQuarterly = this.toObjectArray(incomeRecord?.quarterlyReports).slice(0, 10).map(record => this.mapIncomeRecord(record));
    const cashFlow = this.toObjectArray(cashFlowRecord?.annualReports).slice(0, 2).map(record => this.mapCashFlowRecord(record));

    const dailyEntries = this.toDailyPriceEntries(dailyRecord?.["Time Series (Daily)"]);
    const quotePrice = this.getNumber(this.toRecord(quoteRecord?.["Global Quote"]), "05. price");
    const latestPrice = quotePrice ?? dailyEntries[0]?.close;
    const marketCap = this.getNumber(overviewRecord, "MarketCapitalization");

    const profile: ProviderProfile | null = overviewRecord
      ? {
          companyName: this.getString(overviewRecord, "Name"),
          ceo: this.getString(overviewRecord, "CEO"),
          country: this.getString(overviewRecord, "Country"),
          isAdr: this.getBoolean(overviewRecord, "IsADR") ?? this.getBoolean(overviewRecord, "isADR"),
          ipoDate: this.getString(overviewRecord, "IPODate") ?? this.getString(overviewRecord, "ipodate"),
          price: latestPrice,
          marketCap
        }
      : null;

    const ratios: ProviderRatios | null = overviewRecord
      ? {
          priceToSalesRatioTTM: this.getNumber(overviewRecord, "PriceToSalesRatioTTM"),
          priceToEarningsRatioTTM: this.getNumber(overviewRecord, "PERatio") ?? this.getNumber(overviewRecord, "TrailingPE")
        }
      : null;

    const priceChange = latestPrice ? this.buildPriceChange(dailyEntries, latestPrice) : null;

    return {
      incomeAnnual,
      incomeQuarterly,
      cashFlow,
      profile,
      ratios,
      priceChange,
      providerOptional: {
        symbol: this.getString(overviewRecord, "Symbol"),
        exchange: this.getString(overviewRecord, "Exchange"),
        sector: this.getString(overviewRecord, "Sector"),
        industry: this.getString(overviewRecord, "Industry"),
        currency: this.getString(overviewRecord, "Currency"),
        latestQuarter: this.getString(overviewRecord, "LatestQuarter"),
        beta: this.getNumber(overviewRecord, "Beta"),
        sharesOutstanding: this.getNumber(overviewRecord, "SharesOutstanding"),
        dividendYield: this.getNumber(overviewRecord, "DividendYield"),
        epsTTM: this.getNumber(overviewRecord, "DilutedEPSTTM") ?? this.getNumber(overviewRecord, "EPS"),
        revenueTTM: this.getNumber(overviewRecord, "RevenueTTM"),
        grossProfitTTM: this.getNumber(overviewRecord, "GrossProfitTTM")
      }
    };
  }
}