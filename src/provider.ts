import { AlphaVantageProvider } from "./providers/alpha-vantage-provider";
import { FmpProvider } from "./providers/fmp-provider";
import { TiingoProvider } from "./providers/tiingo-provider";
import { MarketDataProvider, ProviderRuntimeConfig } from "./types";

export const PROVIDER_IDS = {
  FMP: "fmp",
  ALPHA_VANTAGE: "alpha-vantage",
  TIINGO: "tiingo"
} as const;

export function createProvider(providerId: string, config: ProviderRuntimeConfig): MarketDataProvider {
  switch (providerId.toLowerCase()) {
    case PROVIDER_IDS.FMP:
      return new FmpProvider(config.apiKey);
    case PROVIDER_IDS.ALPHA_VANTAGE:
    case "alphavantage":
    case "alpha_vantage":
      return new AlphaVantageProvider(config.apiKey);
    case PROVIDER_IDS.TIINGO:
      return new TiingoProvider(config.apiKey);
    default:
      throw new Error(`Unsupported provider '${providerId}'. Add a provider in src/provider.ts.`);
  }
}
