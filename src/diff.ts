import { CellValue, ColumnFormat, RawTickerData, StockInputItem } from "./types";

export interface ProviderDiffInput {
  providerId: string;
  rawDataByTicker: Record<string, RawTickerData>;
}

export interface DiffSheetData {
  headers: string[];
  rows: CellValue[][];
  columnFormats: ColumnFormat[];
  errors: string[];
}

interface ComparisonSpec {
  field: string;
  period: string;
  getValues: (batch: RawTickerData) => Array<{ period: string; value: unknown }>;
}

interface DiffRow {
  ticker: string;
  field: string;
  period: string;
  values: string[];
}

const DIFFERENCE_THRESHOLD = 0.05;

const COMPARISON_SPECS: ComparisonSpec[] = [
  {
    field: "incomeAnnual.revenue",
    period: "Annual",
    getValues: batch => batch.incomeAnnual.map(record => ({ period: formatAnnualPeriod(record.date), value: record.revenue }))
  },
  {
    field: "incomeQuarterly.revenue",
    period: "Q[num]",
    getValues: batch => batch.incomeQuarterly.map(record => ({ period: formatQuarterPeriod(record.date), value: record.revenue }))
  },
  {
    field: "incomeQuarterly.grossProfit",
    period: "Q[num]",
    getValues: batch => batch.incomeQuarterly.map(record => ({ period: formatQuarterPeriod(record.date), value: record.grossProfit }))
  },
  {
    field: "cashFlow.operatingCashFlow",
    period: "Annual",
    getValues: batch => batch.cashFlow.map((record, index) => ({ period: formatAnnualPeriod(batch.incomeAnnual[index]?.date), value: record.operatingCashFlow }))
  },
  {
    field: "cashFlow.capitalExpenditure",
    period: "Annual",
    getValues: batch => batch.cashFlow.map((record, index) => ({ period: formatAnnualPeriod(batch.incomeAnnual[index]?.date), value: record.capitalExpenditure }))
  },
  {
    field: "profile.marketCap",
    period: "Current",
    getValues: batch => [{ period: "Current", value: batch.profile?.marketCap }]
  },
  {
    field: "ratios.priceToSalesRatioTTM",
    period: "TTM",
    getValues: batch => [{ period: "TTM", value: batch.ratios?.priceToSalesRatioTTM }]
  },
  {
    field: "ratios.priceToEarningsRatioTTM",
    period: "TTM",
    getValues: batch => [{ period: "TTM", value: batch.ratios?.priceToEarningsRatioTTM }]
  }
];

export function buildDiffSheetData(inputData: StockInputItem[], runs: ProviderDiffInput[]): DiffSheetData {
  const headers = ["Ticker", "Field", "Period", ...runs.map(run => formatProviderLabel(run.providerId))];
  const rows: DiffRow[] = [];

  for (const inputItem of inputData) {
    const ticker = inputItem.symbol;
    const batches = runs.map(run => run.rawDataByTicker[ticker] ?? null);

    for (const spec of COMPARISON_SPECS) {
      const periodBuckets = new Map<string, Array<unknown>>();

      for (let providerIndex = 0; providerIndex < runs.length; providerIndex++) {
        const batch = batches[providerIndex];
        if (!batch) continue;

        for (const entry of spec.getValues(batch)) {
          if (!periodBuckets.has(entry.period)) {
            periodBuckets.set(entry.period, Array.from({ length: runs.length }, () => undefined));
          }

          periodBuckets.get(entry.period)![providerIndex] = entry.value;
        }
      }

      for (const [period, values] of periodBuckets.entries()) {
        if (!hasDifference(values)) continue;

        rows.push({
          ticker,
          field: spec.field,
          period,
          values: values.map(value => formatDisplayValue(value))
        });
      }
    }
  }

  const sortedRows = rows.sort((left, right) => {
    if (left.ticker !== right.ticker) return left.ticker.localeCompare(right.ticker);
    if (left.field !== right.field) return left.field.localeCompare(right.field);
    return comparePeriodLabels(left.period, right.period);
  });

  const warnings = sortedRows.length > 0
    ? [`Found ${sortedRows.length} provider differences above the ${Math.round(DIFFERENCE_THRESHOLD * 100)}% threshold or exact mismatches.`]
    : ["No provider differences above the comparison threshold were found."];

  return {
    headers,
    rows: sortedRows.map(row => [row.ticker, row.field, row.period, ...row.values]),
    columnFormats: Array.from({ length: headers.length }, () => "string"),
    errors: warnings
  };
}

function hasDifference(values: unknown[]): boolean {
  const presentValues = values.filter(value => !isEmptyValue(value));
  if (presentValues.length === 0) return false;

  if (presentValues.length !== values.length) return true;

  const numericValues = presentValues.map(value => toNumber(value)).filter((value): value is number => value !== null);
  if (numericValues.length !== presentValues.length) {
    return true;
  }

  for (let left = 0; left < numericValues.length; left++) {
    for (let right = left + 1; right < numericValues.length; right++) {
      if (isNumericDifferenceAboveThreshold(numericValues[left], numericValues[right])) {
        return true;
      }
    }
  }

  return false;
}

function isNumericDifferenceAboveThreshold(left: number, right: number): boolean {
  if (left === right) return false;

  const scale = Math.min(Math.abs(left), Math.abs(right));
  if (scale === 0) return true;

  return Math.abs(left - right) / scale > DIFFERENCE_THRESHOLD;
}

function formatDisplayValue(value: unknown): string {
  if (isEmptyValue(value)) return "N/A";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function formatAnnualPeriod(date: string | undefined): string {
  if (!date) return "FY??";
  const year = new Date(date).getFullYear();
  return Number.isNaN(year) ? "FY??" : `FY${year}`;
}

function formatQuarterPeriod(date: string | undefined): string {
  if (!date) return "Q?";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Q?";
  const quarter = Math.ceil((parsed.getMonth() + 1) / 3);
  return `${parsed.getFullYear()}Q${quarter}`;
}

function formatProviderLabel(providerId: string): string {
  return providerId.replace(/[-_]+/g, " ").trim().toUpperCase();
}

function comparePeriodLabels(left: string, right: string): number {
  const leftKey = periodSortKey(left);
  const rightKey = periodSortKey(right);
  if (leftKey === rightKey) return left.localeCompare(right);
  return rightKey.localeCompare(leftKey);
}

function periodSortKey(period: string): string {
  if (period.startsWith("FY")) return `${period.slice(2).padStart(4, "0")}ZZ`;
  if (/^\d{4}Q[1-4]$/.test(period)) return period.replace("Q", "");
  if (period === "Current") return "9999";
  if (period === "TTM") return "9998";
  return period;
}