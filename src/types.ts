export type CellValue = string | number;

export interface MetricField<T extends CellValue = CellValue> {
  v: T;
  n: string;
}

export type MetricValue = MetricField<CellValue>;

export interface StockInputItem {
  symbol: string;
  industry: string;
}

export interface StockInputGroup {
  TARGET_SHEET_NAME: string;
  DATA_PROVIDER: string;
  INPUT_DATA: StockInputItem[];
}

export interface ProviderProfile {
  companyName?: string;
  ceo?: string;
  country?: string;
  isAdr?: boolean;
  ipoDate?: string;
  price?: number | string;
  marketCap?: number | string;
}

export interface ProviderRatios {
  priceToSalesRatioTTM?: number | string;
  priceToEarningsRatioTTM?: number | string;
}

export interface ProviderPriceChange {
  "5D"?: number | string;
  "1M"?: number | string;
  "3M"?: number | string;
  "1Y"?: number | string;
}

export interface IncomeStatementRecord {
  date?: string;
  revenue?: number | string;
  grossProfit?: number | string;
}

export interface CashFlowRecord {
  operatingCashFlow?: number | string;
  capitalExpenditure?: number | string;
}

export interface NormalizedTickerBatch {
  incomeAnnual: IncomeStatementRecord[];
  incomeQuarterly: IncomeStatementRecord[];
  cashFlow: CashFlowRecord[];
  profile: ProviderProfile | null;
  ratios: ProviderRatios | null;
  priceChange: ProviderPriceChange | null;
  // Provider-specific optional data that is not required by standardized metrics.
  providerOptional?: Record<string, unknown>;
}

export interface RawTickerData extends NormalizedTickerBatch {
  ticker: string;
  industry: string;
}

// Standardized input contract consumed by metric formulas.
// Providers may expose extra data via providerOptional, but formulas should depend on this shape.
export type StandardizedMetricsInput = Pick<
  RawTickerData,
  "ticker" | "industry" | "incomeAnnual" | "incomeQuarterly" | "cashFlow" | "profile" | "ratios" | "priceChange"
>;

export interface DashboardDataset {
  targetSheetName: string;
  generatedAt: string;
  columns: Array<{ header: string; note: string; format: ColumnFormat }>;
  rows: CellValue[][];
  notes: string[][];
  errors: string[];
}

export interface DashboardRunResult extends DashboardDataset {
  rawDataByTicker: Record<string, RawTickerData>;
}

export type ColumnFormat = "string" | "number" | "percent" | "currency" | "large_currency";

export interface ProviderRuntimeConfig {
  apiKey: string;
}

export interface MarketDataProvider {
  readonly id: string;
  fetchTickerDataBatch(ticker: string): Promise<NormalizedTickerBatch>;
}

export interface ProviderFactory {
  create(config: ProviderRuntimeConfig): MarketDataProvider;
}

export interface ColumnDefinition {
  header: string;
  note: string;
  format: ColumnFormat;
  getValue: (data: CalculatedMetrics) => CellValue;
  getNote: (data: CalculatedMetrics) => string;
}

export interface CalculatedMetrics {
  ticker: MetricValue;
  industry: MetricValue;
  price: MetricValue;
  pctChange: MetricValue;
  ps: MetricValue;
  pe: MetricValue;
  mcap: MetricValue;
  lqr: MetricValue;
  yoy: MetricValue;
  latestQoq: MetricValue;
  margin: MetricValue;
  fcf: MetricValue;
  qtqStr: MetricValue;
  aqg: MetricValue;
  waqg: MetricValue;
  pr: MetricValue;
  wpr: MetricValue;
  svr: MetricValue;
  gvr: MetricValue;
  wgvr: MetricValue;
}
