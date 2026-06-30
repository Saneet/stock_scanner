# Stock Scanner

This repository runs a stock scanner in TypeScript and updates Google Sheets on each execution when configured.

It uses a pluggable provider architecture so you can swap Alpha Vantage, FinancialModelingPrep (FMP), or another market data API without changing the metric or sheet logic.

## Architecture Decisions

- Each stock-group config in `src/constants.ts` can also set its own `DATA_PROVIDER`, and the runner will create one dashboard per config.
- Providers can return optional provider-specific fields via `providerOptional` in `NormalizedTickerBatch`.
- Metric formulas are based on a standardized input contract (`StandardizedMetricsInput`) and stay provider-agnostic.
- If a provider lacks a direct endpoint (for example, price change windows), that provider should pre-calculate and map values to standardized fields.

## Project structure

- `src/constants.ts` — configuration for API keys, provider selection, and stock lists.
- `src/provider.ts` — provider factory.
- `src/providers/alpha-vantage-provider.ts` — Alpha Vantage provider implementation.
- `src/providers/fmp-provider.ts` — FinancialModelingPrep provider implementation.
- `src/metrics.ts` — typed metric calculations and column definitions.
- `src/dashboard.ts` — provider-agnostic fetch/process pipeline.
- `src/index.ts` — main runner that executes the scanner for AI and other stock groups.
- `.github/workflows/stock-scanner-hourly.yml` — GitHub Actions workflow scheduled to run hourly.

## Requirements

- Node.js 18 or newer
- `ALPHA_VANTAGE_API_KEY` environment variable containing the Alpha Vantage API key
- `FMP_API_KEY` environment variable containing the FinancialModelingPrep API key

## Local usage

1. Install dependencies (if you add any later):

```bash
npm install
```

2. Set your API key(s):

```bash
export ALPHA_VANTAGE_API_KEY="your_api_key_here"
export FMP_API_KEY="your_api_key_here"
```

3. Run the scanner:

```bash
npm run fetch

# Verify TypeScript types
npm run typecheck
```

4. If Google Sheets is configured, results are written directly to the target sheet(s).

To route different sheets through different providers, set `DATA_PROVIDER` on each config object in `src/constants.ts` and add it to `DASHBOARD_CONFIGS`.

## GitHub Actions

The workflow `.github/workflows/stock-scanner-hourly.yml` is configured to run every hour.

### Required secret

- `ALPHA_VANTAGE_API_KEY`
- `FMP_API_KEY`

Set this in your repository settings under `Settings > Secrets and variables > Actions`.

## Notes

- The runner does not persist local JSON files by default; it updates Google Sheets when properly configured.
- To write to Google Sheets, set `SPREADSHEET_ID`, and use a Google service account with `GOOGLE_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`.
- Share the spreadsheet with the service account email, then set the secret `GOOGLE_SERVICE_ACCOUNT_KEY` in GitHub Actions.
- Update `src/constants.ts` to change the stock lists or target sheet names if needed.

## Adding Another API Provider

1. Create a provider class in `src/providers/` that implements `MarketDataProvider` from `src/types.ts`.
2. Map your API responses into `NormalizedTickerBatch` in that provider.
3. Register the provider in `src/provider.ts`.
4. Set `DATA_PROVIDER` to your provider id.

This keeps metrics and Google Sheets writing unchanged while allowing provider-specific fetch/mapping code.

### Quick Start Template

- Copy `src/providers/provider-template.ts`.
- Rename `ProviderTemplate` and `id`.
- Implement API fetch + response mapping in `fetchTickerDataBatch`.
- Register your provider in `src/provider.ts`.
- Set `DATA_PROVIDER` to your provider id.

### Provider Mapping Checklist

- Ensure `incomeAnnual` includes at least date + revenue when available.
- Ensure `incomeQuarterly` includes date + revenue + grossProfit when available.
- Ensure `cashFlow` includes operatingCashFlow + capitalExpenditure when available.
- Map quote/company fields into `profile` (price, marketCap, companyName, ceo, ipoDate, etc.).
- Map valuation fields into `ratios` (`priceToSalesRatioTTM`, `priceToEarningsRatioTTM`).
- Map price performance into `priceChange` (`5D`, `1M`, `3M`, `1Y`), pre-calculate if needed.
- Put any extra provider-only fields under `providerOptional`.
