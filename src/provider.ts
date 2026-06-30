import { FmpProvider } from "./providers/fmp-provider";
import { MarketDataProvider, ProviderRuntimeConfig } from "./types";

export const PROVIDER_IDS = {
  FMP: "fmp"
} as const;

export function createProvider(providerId: string, config: ProviderRuntimeConfig): MarketDataProvider {
  switch (providerId.toLowerCase()) {
    case PROVIDER_IDS.FMP:
      return new FmpProvider(config.apiKeys);
    default:
      throw new Error(`Unsupported provider '${providerId}'. Add a provider in src/provider.ts.`);
  }
}
