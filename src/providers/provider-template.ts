import { MarketDataProvider, NormalizedTickerBatch } from "../types";

interface ProviderTemplateConfig {
  apiKeys?: string[];
  baseUrl?: string;
}

export class ProviderTemplate implements MarketDataProvider {
  // Change this id and register it in src/provider.ts.
  readonly id = "template";

  private readonly apiKeys: string[];
  private readonly baseUrl: string;

  constructor(config: ProviderTemplateConfig = {}) {
    this.apiKeys = config.apiKeys ?? [];
    this.baseUrl = config.baseUrl ?? "https://api.example.com";
  }

  async fetchTickerDataBatch(ticker: string): Promise<NormalizedTickerBatch> {
    // 1) Fetch raw data from your API.
    // 2) Pre-calculate/massage fields your API does not provide directly.
    // 3) Map to standardized fields below so metrics remain provider-agnostic.

    void ticker;
    void this.apiKeys;
    void this.baseUrl;

    return {
      incomeAnnual: [],
      incomeQuarterly: [],
      cashFlow: [],
      profile: null,
      ratios: null,
      priceChange: null,
      providerOptional: {
        // Put provider-specific optional fields here.
        // Example: rawEarningsCalendar: [...]
      }
    };
  }
}
