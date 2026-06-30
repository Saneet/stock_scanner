import { CalculatedMetrics, CellValue, ColumnDefinition, MetricValue, StandardizedMetricsInput } from "./types";

export const COLUMN_CONFIG: ColumnDefinition[] = [
  { header: "Ticker", note: "Stock Ticker Symbol", format: "string", getValue: d => d.ticker.v, getNote: d => d.ticker.n },
  { header: "Industry", note: "Company Industry", format: "string", getValue: d => d.industry.v, getNote: d => d.industry.n },
  { header: "SVR", note: "Simple Valuation Ratio: Market Cap / (Last quarter revenue * 4)", format: "number", getValue: d => d.svr.v, getNote: d => d.svr.n },
  { header: "GVR", note: "Growth Valuation Ratio: Market Cap / (Projected Revenue)", format: "number", getValue: d => d.gvr.v, getNote: d => d.gvr.n },
  { header: "WGVR", note: "Weighted Growth Valuation Ratio: Market Cap / (Weighted Projected Revenue)", format: "number", getValue: d => d.wgvr.v, getNote: d => d.wgvr.n },
  { header: "Seq QoQ", note: "Sequential quarter-over-quarter revenue growth.", format: "string", getValue: d => d.latestQoq.v, getNote: d => d.latestQoq.n },
  { header: "YoY QtQ", note: "Latest Quarter to Quarter growth (YoY for the quarter) for last 4 quarters.", format: "string", getValue: d => d.qtqStr.v, getNote: d => d.qtqStr.n },
  { header: "YoY Gr", note: "Year over year revenue growth for the last 3 fiscal years.", format: "string", getValue: d => d.yoy.v, getNote: d => d.yoy.n },
  { header: "Margin", note: "Gross Margin for the last 4 quarters.", format: "string", getValue: d => d.margin.v, getNote: d => d.margin.n },
  { header: "FCF Yld", note: "Free Cash Flow Yield.", format: "percent", getValue: d => d.fcf.v, getNote: d => d.fcf.n },
  { header: "% Change", note: "1W, 1M, 3M, 1Y % Change", format: "string", getValue: d => d.pctChange.v, getNote: d => d.pctChange.n },
  { header: "MCap", note: "Market Capitalization", format: "large_currency", getValue: d => d.mcap.v, getNote: d => d.mcap.n },
  { header: "Price", note: "Current Stock Price", format: "currency", getValue: d => d.price.v, getNote: d => d.price.n },
  { header: "P/S", note: "Price to Sales Ratio (TTM)", format: "number", getValue: d => d.ps.v, getNote: d => d.ps.n },
  { header: "P/E", note: "Price to Earnings Ratio (TTM)", format: "number", getValue: d => d.pe.v, getNote: d => d.pe.n },
  { header: "LQR", note: "Last Quarter Revenue", format: "large_currency", getValue: d => d.lqr.v, getNote: d => d.lqr.n },
  { header: "PR", note: "Projected Revenue: Last 4 quarter revenue * (1 + Avg QtQ growth)", format: "large_currency", getValue: d => d.pr.v, getNote: d => d.pr.n },
  { header: "WPR", note: "Weighted Projected Revenue: Last 4 quarter revenue * (1 + Weighted Avg QtQ growth)", format: "large_currency", getValue: d => d.wpr.v, getNote: d => d.wpr.n },
  { header: "AQG", note: "Average Quarter to Quarter growth of the last 4 quarters.", format: "percent", getValue: d => d.aqg.v, getNote: d => d.aqg.n },
  { header: "WAQG", note: "Weighted Avg QtQ growth (0.4 for latest, 0.3, 0.2, 0.1 for oldest).", format: "percent", getValue: d => d.waqg.v, getNote: d => d.waqg.n }
];

class Utils {
  static parseNum(val: unknown): number {
    if (val === "None" || val === null || val === undefined) return 0;
    const parsed = parseFloat(String(val));
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}

class Formatter {
  static toPercentStr(value: number | "UNAVAILABLE"): string {
    return value === "UNAVAILABLE" ? value : `${(value * 100).toFixed(2)}%`;
  }

  static toDirectPercentStr(value: unknown): string {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
    return `${parseFloat(String(value)).toFixed(2)}%`;
  }

  static num(val: unknown): string {
    if (val === "UNAVAILABLE" || val === "NEG") return String(val);
    return Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  static extractYearShort(dateStr: string | undefined): string {
    if (!dateStr) return "??";
    const date = new Date(dateStr);
    return Number.isNaN(date.getTime()) ? "??" : String(date.getFullYear()).slice(-2);
  }

  static buildQuarterLabel(dateStr: string | undefined): string {
    if (!dateStr) return "??Q?";
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "??Q?";
    return `${String(date.getFullYear()).slice(-2)}Q${Math.ceil((date.getMonth() + 1) / 3)}`;
  }

  static makeNote(formula: string, values: string): string {
    if (!formula && !values) return "";
    return `Formula: ${formula}\nValues: ${values}`;
  }
}

export class MetricsCalculator {
  static createField(value: CellValue, formula = "", values = ""): MetricValue {
    return { v: value, n: Formatter.makeNote(formula, values) };
  }

  static calculateAll(data: StandardizedMetricsInput): CalculatedMetrics {
    const { ticker, industry, incomeAnnual, incomeQuarterly, cashFlow, profile, ratios, priceChange } = data;

    const m: CalculatedMetrics = {
      ticker: this.createField(ticker, "User Input", ticker),
      industry: this.createField(industry, "User Input", industry),
      price: this.createField("UNAVAILABLE"),
      pctChange: this.createField("UNAVAILABLE"),
      ps: this.createField("UNAVAILABLE"),
      pe: this.createField("UNAVAILABLE"),
      mcap: this.createField("UNAVAILABLE"),
      lqr: this.createField("UNAVAILABLE"),
      yoy: this.createField("UNAVAILABLE"),
      latestQoq: this.createField("UNAVAILABLE"),
      margin: this.createField("UNAVAILABLE"),
      fcf: this.createField("UNAVAILABLE"),
      qtqStr: this.createField("UNAVAILABLE"),
      aqg: this.createField("UNAVAILABLE"),
      waqg: this.createField("UNAVAILABLE"),
      pr: this.createField("NEG"),
      wpr: this.createField("NEG"),
      svr: this.createField("NEG"),
      gvr: this.createField("NEG"),
      wgvr: this.createField("NEG")
    };

    if (profile) {
      const name = profile.companyName || "N/A";
      const ceo = profile.ceo || "N/A";
      const country = profile.country || "N/A";
      const isAdr = profile.isAdr !== undefined ? profile.isAdr : "N/A";
      let yearsPublic = "N/A";
      if (profile.ipoDate) {
        const ipo = new Date(profile.ipoDate);
        if (!Number.isNaN(ipo.getTime())) {
          const diffMs = Date.now() - ipo.getTime();
          yearsPublic = (diffMs / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
        }
      }
      const tickerNoteStr = `${name}\nCEO: ${ceo}\nCountry: ${country}\nADR: ${isAdr}\nYears Public: ${yearsPublic}`;
      m.ticker = this.createField(ticker, "API: Profile", tickerNoteStr);
    }

    if (profile && profile.price !== undefined && profile.price !== null) {
      const currentPrice = Utils.parseNum(profile.price);
      m.price = this.createField(currentPrice, "API: Profile [price]", Formatter.num(currentPrice));
    }

    if (priceChange && Object.keys(priceChange).length > 0) {
      const w1 = Formatter.toDirectPercentStr(priceChange["5D"]);
      const m1 = Formatter.toDirectPercentStr(priceChange["1M"]);
      const m3 = Formatter.toDirectPercentStr(priceChange["3M"]);
      const y1 = Formatter.toDirectPercentStr(priceChange["1Y"]);
      const pctStr = `1W: ${w1}\n1M: ${m1}\n3M: ${m3}\n1Y: ${y1}`;
      const noteStr = `Raw values:\n1W (5D): ${priceChange["5D"]}\n1M: ${priceChange["1M"]}\n3M: ${priceChange["3M"]}\n1Y: ${priceChange["1Y"]}`;
      m.pctChange = this.createField(pctStr, "API: Stock Price Change", noteStr);
    }

    let mcapVal: number | null = null;
    if (profile && profile.marketCap) {
      mcapVal = Utils.parseNum(profile.marketCap);
      m.mcap = this.createField(mcapVal, "API: Profile [marketCap]", Formatter.num(mcapVal));
    }

    if (ratios) {
      if (ratios.priceToSalesRatioTTM !== undefined) {
        const psVal = Utils.parseNum(ratios.priceToSalesRatioTTM);
        m.ps = this.createField(psVal, "API: Ratios TTM [priceToSalesRatioTTM]", Formatter.num(psVal));
      }
      if (ratios.priceToEarningsRatioTTM !== undefined) {
        const peVal = Utils.parseNum(ratios.priceToEarningsRatioTTM);
        m.pe = this.createField(peVal, "API: Ratios TTM [priceToEarningsRatioTTM]", Formatter.num(peVal));
      }
    }

    if (incomeQuarterly.length > 0) {
      const q = incomeQuarterly;
      const lqrVal = Utils.parseNum(q[0]?.revenue);
      m.lqr = this.createField(lqrVal, "API: Income Statement [Quarterly revenue 0]", Formatter.num(lqrVal));

      const qoqArr: string[] = [];
      const qoqNotes: string[] = [];
      const marginArr: string[] = [];
      const marginNotes: string[] = [];

      for (let i = 0; i < Math.min(q.length, 5); i++) {
        const rev = Utils.parseNum(q[i]?.revenue);
        const gross = Utils.parseNum(q[i]?.grossProfit);
        const lbl = Formatter.buildQuarterLabel(q[i]?.date);
        if (rev !== 0 && i < 4) {
          marginArr.push(`${lbl}: ${Formatter.toPercentStr(gross / rev)}`);
          marginNotes.push(`${lbl} => ${Formatter.num(gross)} / ${Formatter.num(rev)}`);
        }
        if (q[i + 1] && i < 4) {
          const prevRev = Utils.parseNum(q[i + 1]?.revenue);
          const prevLbl = Formatter.buildQuarterLabel(q[i + 1]?.date);
          if (prevRev !== 0) {
            qoqArr.push(`${lbl}: ${Formatter.toPercentStr((rev - prevRev) / prevRev)}`);
            qoqNotes.push(`${lbl} over ${prevLbl} => (${Formatter.num(rev)} - ${Formatter.num(prevRev)}) / ${Formatter.num(prevRev)}`);
          }
        }
      }

      if (qoqArr.length > 0) {
        m.latestQoq = this.createField(qoqArr.join("\n"), "(Current Q Rev - Prior Q Rev) / Prior Q Rev", qoqNotes.join("\n"));
      }
      if (marginArr.length > 0) {
        m.margin = this.createField(marginArr.join("\n"), "Gross Profit / Total Revenue", marginNotes.join("\n"));
      }

      if (q.length >= 8) {
        const qtqNum: Array<number | null> = [];
        const qtqLabels: string[] = [];
        const qtqNotesArr: string[] = [];
        let ttmRev = 0;

        for (let i = 0; i < 4; i++) {
          const curr = Utils.parseNum(q[i]?.revenue);
          const prior = Utils.parseNum(q[i + 4]?.revenue);
          ttmRev += curr;
          if (prior !== 0) {
            const growth = (curr - prior) / prior;
            qtqNum.push(growth);
            const lbl = `${Formatter.buildQuarterLabel(q[i]?.date)}`;
            const lblNote = `${Formatter.buildQuarterLabel(q[i]?.date)} over ${Formatter.buildQuarterLabel(q[i + 4]?.date)}`;
            qtqLabels.push(lbl);
            qtqNotesArr.push(`${lblNote} => (${Formatter.num(curr)} - ${Formatter.num(prior)}) / ${Formatter.num(prior)}`);
          } else {
            qtqNum.push(null);
          }
        }

        if (qtqNum.every((x): x is number => x !== null)) {
          const qtqStrForm = qtqLabels.map((lbl, i) => `${lbl}: ${Formatter.toPercentStr(qtqNum[i])}`).join("\n");
          m.qtqStr = this.createField(qtqStrForm, "(Current Q Rev - Prior Year Same Q Rev) / Prior Year Same Q Rev", qtqNotesArr.join("\n"));

          const aqgVal = qtqNum.reduce((a, b) => a + b, 0) / 4;
          const aqgNoteVals = `(${Formatter.toPercentStr(qtqNum[0])} + ${Formatter.toPercentStr(qtqNum[1])} + ${Formatter.toPercentStr(qtqNum[2])} + ${Formatter.toPercentStr(qtqNum[3])}) / 4`;
          m.aqg = this.createField(aqgVal, "Sum of last 4 QtQ growths / 4", aqgNoteVals);

          const waqgVal = (0.4 * qtqNum[0]) + (0.3 * qtqNum[1]) + (0.2 * qtqNum[2]) + (0.1 * qtqNum[3]);
          const waqgNoteVals = `(0.4 * ${Formatter.toPercentStr(qtqNum[0])}) + (0.3 * ${Formatter.toPercentStr(qtqNum[1])}) + (0.2 * ${Formatter.toPercentStr(qtqNum[2])}) + (0.1 * ${Formatter.toPercentStr(qtqNum[3])})`;
          m.waqg = this.createField(waqgVal, "(0.4 * Q1) + (0.3 * Q2) + (0.2 * Q3) + (0.1 * Q4)", waqgNoteVals);

          if (ttmRev > 0) {
            if (aqgVal >= 0) {
              const prVal = ttmRev * (1 + aqgVal);
              m.pr = this.createField(prVal, "TTM Revenue * (1 + AQG)", `${Formatter.num(ttmRev)} * (1 + ${Formatter.num(aqgVal)})`);
            }
            if (waqgVal >= 0) {
              const wprVal = ttmRev * (1 + waqgVal);
              m.wpr = this.createField(wprVal, "TTM Revenue * (1 + WAQG)", `${Formatter.num(ttmRev)} * (1 + ${Formatter.num(waqgVal)})`);
            }
          }
        }
      }
    }

    if (incomeAnnual.length > 1) {
      const a = incomeAnnual;
      const yoyArr: string[] = [];
      const yoyNotes: string[] = [];
      for (let i = 0; i < Math.min(a.length - 1, 3); i++) {
        const c = Utils.parseNum(a[i]?.revenue);
        const p = Utils.parseNum(a[i + 1]?.revenue);
        if (p !== 0) {
          const lbl = `FY${Formatter.extractYearShort(a[i]?.date)}`;
          yoyArr.push(`${lbl}: ${Formatter.toPercentStr((c - p) / p)}`);
          yoyNotes.push(`${lbl} => (${Formatter.num(c)} - ${Formatter.num(p)}) / ${Formatter.num(p)}`);
        }
      }
      if (yoyArr.length > 0) {
        m.yoy = this.createField(yoyArr.join("\n"), "(Current FY Rev - Prior FY Rev) / Prior FY Rev", yoyNotes.join("\n"));
      }
    }

    if (cashFlow.length > 0 && incomeAnnual.length > 0) {
      const ocf = Utils.parseNum(cashFlow[0]?.operatingCashFlow);
      const capex = Utils.parseNum(cashFlow[0]?.capitalExpenditure);
      const rev = Utils.parseNum(incomeAnnual[0]?.revenue);
      if (rev !== 0) {
        const fcfVal = (ocf - Math.abs(capex)) / rev;
        m.fcf = this.createField(
          fcfVal,
          "(Operating Cash Flow - Abs(CapEx)) / Total Revenue",
          `(${Formatter.num(ocf)} - ${Formatter.num(Math.abs(capex))}) / ${Formatter.num(rev)}`
        );
      }
    }

    if (mcapVal !== null && mcapVal > 0) {
      const lqrVal = m.lqr.v;
      if (typeof lqrVal === "number" && lqrVal > 0) {
        const svrVal = mcapVal / (lqrVal * 4);
        m.svr = this.createField(svrVal, "Market Cap / (Last Qtr Rev * 4)", `${Formatter.num(mcapVal)} / (${Formatter.num(lqrVal)} * 4)`);
      }

      const prVal = m.pr.v;
      if (typeof prVal === "number" && prVal > 0) {
        const gvrVal = mcapVal / prVal;
        m.gvr = this.createField(gvrVal, "Market Cap / (Projected Revenue)", `${Formatter.num(mcapVal)} / (${Formatter.num(prVal)})`);
      }

      const wprVal = m.wpr.v;
      if (typeof wprVal === "number" && wprVal > 0) {
        const wgvrVal = mcapVal / wprVal;
        m.wgvr = this.createField(wgvrVal, "Market Cap / (Weighted Projected Revenue)", `${Formatter.num(mcapVal)} / (${Formatter.num(wprVal)})`);
      }
    }

    return m;
  }
}
