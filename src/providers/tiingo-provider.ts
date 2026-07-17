import { logger } from "../logger";
import { CashFlowRecord, IncomeStatementRecord, MarketDataProvider, NormalizedTickerBatch, ProviderProfile, ProviderRatios } from "../types";

interface TiingoStatementGroup {
  date: string;
  year: number;
  quarter: number;
  data: Record<string, number>;
}

export class TiingoProvider implements MarketDataProvider {
  readonly id = "tiingo";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.tiingo.com") {
    if (!apiKey) {
      throw new Error("Tiingo provider requires an API key.");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Parses a single CSV line, respecting double-quoted fields that may contain commas.
   */
  private parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  private parseCsv(text: string): Array<Record<string, string>> {
    const lines = text.trim().split("\n").filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = this.parseCsvLine(lines[0]);
    return lines.slice(1).map(line => {
      const values = this.parseCsvLine(line);
      const record: Record<string, string> = {};
      headers.forEach((header, i) => {
        record[header] = values[i] ?? "";
      });
      return record;
    });
  }

  private async fetchCsv(url: string): Promise<Array<Record<string, string>>> {
    const safeUrl = url.replace(/token=[^&]+/, "token=***");
    logger.debug(`Fetching Tiingo URL: ${safeUrl}`);

    const response = await fetch(url);
    const text = await response.text();
    logger.debug(`Received HTTP ${response.status} for Tiingo URL: ${safeUrl}`);

    if (!response.ok) {
      logger.error(`Tiingo API error ${response.status} for ${safeUrl}: ${text.slice(0, 200)}`);
      return [];
    }

    return this.parseCsv(text);
  }

  private getNum(val: string | undefined): number | undefined {
    if (!val || val === "") return undefined;
    const parsed = parseFloat(val);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private getBool(val: string | undefined): boolean | undefined {
    if (!val) return undefined;
    const lower = val.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    return undefined;
  }

  private toDateString(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  /**
   * Pivots the long-format statements CSV (one row per dataCode) into grouped objects
   * keyed by (date, quarter), where each group holds all dataCodes as a flat record.
   * Results are sorted by date descending.
   */
  private pivotStatements(rows: Array<Record<string, string>>): TiingoStatementGroup[] {
    const groups = new Map<string, TiingoStatementGroup>();

    for (const row of rows) {
      const date = row["date"] ?? "";
      const quarter = row["quarter"] ?? "0";
      const key = `${date}-q${quarter}`;

      if (!groups.has(key)) {
        groups.set(key, {
          date,
          year: parseInt(row["year"] ?? "0"),
          quarter: parseInt(quarter),
          data: {}
        });
      }

      const group = groups.get(key)!;
      const val = this.getNum(row["value"]);
      const dataCode = row["dataCode"];
      if (val !== undefined && dataCode) {
        // In case of duplicate dataCodes in the same period (e.g. piotroskiFScore), last write wins.
        group.data[dataCode] = val;
      }
    }

    return Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  private mapToAnnualIncomeRecord(group: TiingoStatementGroup): IncomeStatementRecord {
    return {
      date: group.date,
      revenue: group.data["revenue"]
    };
  }

  private mapToQuarterlyIncomeRecord(group: TiingoStatementGroup): IncomeStatementRecord {
    return {
      date: group.date,
      revenue: group.data["revenue"],
      grossProfit: group.data["grossProfit"]
    };
  }

  private mapToCashFlowRecord(group: TiingoStatementGroup): CashFlowRecord {
    return {
      // ncfo = Net Cash Flow from Operations
      operatingCashFlow: group.data["ncfo"],
      // capex is reported as a negative number; store as-is (metrics layer uses Math.abs)
      capitalExpenditure: group.data["capex"]
    };
  }

  async fetchTickerDataBatch(ticker: string): Promise<NormalizedTickerBatch> {
    const token = this.apiKey;
    const upperTicker = ticker.toUpperCase();
    const lowerTicker = ticker.toLowerCase();

    const today = new Date();

    const recentDate = new Date(today);
    recentDate.setDate(today.getDate() - 7);

    // #3 Meta: company profile (name, sector, ADR status, location, etc.)
    const metaRows = await this.fetchCsv(
      `${this.baseUrl}/tiingo/fundamentals/meta?token=${token}&tickers=${encodeURIComponent(upperTicker)}&format=csv`
    );

    // #2 Statements: all financial statement data in long format
    const stmtRows = await this.fetchCsv(
      `${this.baseUrl}/tiingo/fundamentals/${encodeURIComponent(lowerTicker)}/statements?token=${token}&format=csv&sort=-date`
    );

    // #4 Daily: latest market cap and P/E ratio
    const dailyRows = await this.fetchCsv(
      `${this.baseUrl}/tiingo/fundamentals/${encodeURIComponent(lowerTicker)}/daily?token=${token}&columns=marketCap,peRatio&sort=-date&startDate=${this.toDateString(recentDate)}&format=csv`
    );

    // --- Statements ---
    const allGroups = this.pivotStatements(stmtRows);
    const annualGroups = allGroups.filter(g => g.quarter === 0);
    const quarterlyGroups = allGroups.filter(g => g.quarter !== 0);

    const incomeAnnual = annualGroups.slice(0, 5).map(g => this.mapToAnnualIncomeRecord(g));
    const incomeQuarterly = quarterlyGroups.slice(0, 10).map(g => this.mapToQuarterlyIncomeRecord(g));
    const cashFlow = annualGroups.slice(0, 2).map(g => this.mapToCashFlowRecord(g));

    // --- Meta ---
    const meta = metaRows[0] ?? null;

    // --- Daily fundamentals ---
    const dailyLatest = dailyRows[0] ?? null;
    const marketCap = dailyLatest ? this.getNum(dailyLatest["marketCap"]) : undefined;
    const peRatio = dailyLatest ? this.getNum(dailyLatest["peRatio"]) : undefined;

    // Compute TTM P/S from marketCap / sum of last 4 quarterly revenues
    const ttmRevenue = quarterlyGroups.slice(0, 4).reduce((sum, g) => sum + (g.data["revenue"] ?? 0), 0);
    const psRatio = marketCap !== undefined && ttmRevenue > 0 ? marketCap / ttmRevenue : undefined;

    const profile: ProviderProfile | null = meta
      ? {
          companyName: meta["name"] || undefined,
          country: meta["location"] || undefined,
          isAdr: this.getBool(meta["isADR"]),
          marketCap
        }
      : null;

    const ratios: ProviderRatios | null =
      peRatio !== undefined || psRatio !== undefined
        ? {
            priceToEarningsRatioTTM: peRatio,
            priceToSalesRatioTTM: psRatio
          }
        : null;

    return {
      incomeAnnual,
      incomeQuarterly,
      cashFlow,
      profile,
      ratios,
      priceChange: null,
      providerOptional: {
        sector: meta?.["sector"],
        industry: meta?.["industry"],
        reportingCurrency: meta?.["reportingCurrency"],
        isActive: meta ? this.getBool(meta["isActive"]) : undefined,
        statementLastUpdated: meta?.["statementLastUpdated"],
        dailyLastUpdated: meta?.["dailyLastUpdated"]
      }
    };
  }
}
