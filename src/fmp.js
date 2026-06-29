import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

export const COLUMN_CONFIG = [
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

export class Utils {
  static parseNum(val) {
    if (val === "None" || val === null || val === undefined) return 0;
    const parsed = parseFloat(val);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}

export class Formatter {
  static toPercentStr(value) {
    return value === "UNAVAILABLE" ? value : `${(value * 100).toFixed(2)}%`;
  }

  static toDirectPercentStr(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
    return `${parseFloat(value).toFixed(2)}%`;
  }

  static num(val) {
    if (val === "UNAVAILABLE" || val === "NEG") return val;
    return Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  static extractYearShort(dateStr) {
    const date = new Date(dateStr);
    return Number.isNaN(date.getTime()) ? "??" : String(date.getFullYear()).slice(-2);
  }

  static buildQuarterLabel(dateStr) {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "??Q?";
    return `${String(date.getFullYear()).slice(-2)}Q${Math.ceil((date.getMonth() + 1) / 3)}`;
  }

  static makeNote(formula, values) {
    if (!formula && !values) return "";
    return `Formula: ${formula}\nValues: ${values}`;
  }
}

export class MetricsCalculator {
  static createField(value, formula = "", values = "") {
    return { v: value, n: Formatter.makeNote(formula, values) };
  }

  static calculateAll(data) {
    const { ticker, industry, fmpIncomeAnnual, fmpIncomeQuarterly, fmpCashFlow, fmpProfile, fmpRatios, fmpPriceChange } = data;

    const m = {
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

    let tickerNoteStr = "User Input";
    if (fmpProfile) {
      const name = fmpProfile.companyName || "N/A";
      const ceo = fmpProfile.ceo || "N/A";
      const country = fmpProfile.country || "N/A";
      const isAdr = fmpProfile.isAdr !== undefined ? fmpProfile.isAdr : "N/A";
      let yearsPublic = "N/A";
      if (fmpProfile.ipoDate) {
        const ipo = new Date(fmpProfile.ipoDate);
        if (!Number.isNaN(ipo.getTime())) {
          const diffMs = Date.now() - ipo.getTime();
          yearsPublic = (diffMs / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
        }
      }
      tickerNoteStr = `${name}\nCEO: ${ceo}\nCountry: ${country}\nADR: ${isAdr}\nYears Public: ${yearsPublic}`;
      m.ticker = this.createField(ticker, "API: Profile", tickerNoteStr);
    }

    if (fmpProfile && fmpProfile.price !== undefined && fmpProfile.price !== null) {
      const currentPrice = Utils.parseNum(fmpProfile.price);
      m.price = this.createField(currentPrice, "API: Profile [price]", Formatter.num(currentPrice));
    }

    if (fmpPriceChange && Object.keys(fmpPriceChange).length > 0) {
      const w1 = Formatter.toDirectPercentStr(fmpPriceChange["5D"]);
      const m1 = Formatter.toDirectPercentStr(fmpPriceChange["1M"]);
      const m3 = Formatter.toDirectPercentStr(fmpPriceChange["3M"]);
      const y1 = Formatter.toDirectPercentStr(fmpPriceChange["1Y"]);
      const pctStr = `1W: ${w1}\n1M: ${m1}\n3M: ${m3}\n1Y: ${y1}`;
      const noteStr = `Raw values:\n1W (5D): ${fmpPriceChange["5D"]}\n1M: ${fmpPriceChange["1M"]}\n3M: ${fmpPriceChange["3M"]}\n1Y: ${fmpPriceChange["1Y"]}`;
      m.pctChange = this.createField(pctStr, "API: Stock Price Change", noteStr);
    }

    let mcapVal = null;
    if (fmpProfile && fmpProfile.mktCap) {
      mcapVal = Utils.parseNum(fmpProfile.mktCap);
      m.mcap = this.createField(mcapVal, "API: Profile [marketCap]", Formatter.num(mcapVal));
    }

    if (fmpRatios) {
      if (fmpRatios.priceToSalesRatioTTM) {
        const psVal = Utils.parseNum(fmpRatios.priceToSalesRatioTTM);
        m.ps = this.createField(psVal, "API: Ratios TTM [priceToSalesRatioTTM]", Formatter.num(psVal));
      }
      if (fmpRatios.priceToEarningsRatioTTM) {
        const peVal = Utils.parseNum(fmpRatios.priceToEarningsRatioTTM);
        m.pe = this.createField(peVal, "API: Ratios TTM [priceToEarningsRatioTTM]", Formatter.num(peVal));
      }
    }

    if (Array.isArray(fmpIncomeQuarterly) && fmpIncomeQuarterly.length > 0) {
      const q = fmpIncomeQuarterly;
      const lqrVal = Utils.parseNum(q[0].revenue);
      m.lqr = this.createField(lqrVal, "API: Income Statement [Quarterly revenue 0]", Formatter.num(lqrVal));

      const qoqArr = [];
      const qoqNotes = [];
      const marginArr = [];
      const marginNotes = [];

      for (let i = 0; i < Math.min(q.length, 5); i++) {
        const rev = Utils.parseNum(q[i].revenue);
        const gross = Utils.parseNum(q[i].grossProfit);
        const lbl = Formatter.buildQuarterLabel(q[i].date);
        if (rev !== 0 && i < 4) {
          marginArr.push(`${lbl}: ${Formatter.toPercentStr(gross / rev)}`);
          marginNotes.push(`${lbl} => ${Formatter.num(gross)} / ${Formatter.num(rev)}`);
        }
        if (q[i + 1] && i < 4) {
          const prevRev = Utils.parseNum(q[i + 1].revenue);
          const prevLbl = Formatter.buildQuarterLabel(q[i + 1].date);
          if (prevRev !== 0) {
            qoqArr.push(`${lbl}: ${Formatter.toPercentStr((rev - prevRev) / prevRev)}`);
            qoqNotes.push(`${lbl} over ${prevLbl} => (${Formatter.num(rev)} - ${Formatter.num(prevRev)}) / ${Formatter.num(prevRev)}`);
          }
        }
      }

      if (qoqArr.length > 0) m.latestQoq = this.createField(qoqArr.join("\n"), "(Current Q Rev - Prior Q Rev) / Prior Q Rev", qoqNotes.join("\n"));
      if (marginArr.length > 0) m.margin = this.createField(marginArr.join("\n"), "Gross Profit / Total Revenue", marginNotes.join("\n"));

      if (q.length >= 8) {
        const qtqNum = [];
        const qtqLabels = [];
        const qtqNotesArr = [];
        let ttmRev = 0;
        for (let i = 0; i < 4; i++) {
          const curr = Utils.parseNum(q[i].revenue);
          const prior = Utils.parseNum(q[i + 4].revenue);
          ttmRev += curr;
          if (prior !== 0) {
            const growth = (curr - prior) / prior;
            qtqNum.push(growth);
            const lbl = `${Formatter.buildQuarterLabel(q[i].date)}`;
            const lblNote = `${Formatter.buildQuarterLabel(q[i].date)} over ${Formatter.buildQuarterLabel(q[i + 4].date)}`;
            qtqLabels.push(lbl);
            qtqNotesArr.push(`${lblNote} => (${Formatter.num(curr)} - ${Formatter.num(prior)}) / ${Formatter.num(prior)}`);
          } else {
            qtqNum.push(null);
          }
        }

        if (qtqNum.every(x => x !== null)) {
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

    if (Array.isArray(fmpIncomeAnnual) && fmpIncomeAnnual.length > 1) {
      const a = fmpIncomeAnnual;
      const yoyArr = [];
      const yoyNotes = [];
      for (let i = 0; i < Math.min(a.length - 1, 3); i++) {
        const c = Utils.parseNum(a[i].revenue);
        const p = Utils.parseNum(a[i + 1].revenue);
        if (p !== 0) {
          const lbl = `FY${Formatter.extractYearShort(a[i].date)}`;
          yoyArr.push(`${lbl}: ${Formatter.toPercentStr((c - p) / p)}`);
          yoyNotes.push(`${lbl} => (${Formatter.num(c)} - ${Formatter.num(p)}) / ${Formatter.num(p)}`);
        }
      }
      if (yoyArr.length > 0) m.yoy = this.createField(yoyArr.join("\n"), "(Current FY Rev - Prior FY Rev) / Prior FY Rev", yoyNotes.join("\n"));
    }

    if (Array.isArray(fmpCashFlow) && fmpCashFlow.length > 0 && Array.isArray(fmpIncomeAnnual) && fmpIncomeAnnual.length > 0) {
      const ocf = Utils.parseNum(fmpCashFlow[0].operatingCashFlow);
      const capex = Utils.parseNum(fmpCashFlow[0].capitalExpenditure);
      const rev = Utils.parseNum(fmpIncomeAnnual[0].revenue);
      if (rev !== 0) {
        const fcfVal = (ocf - Math.abs(capex)) / rev;
        m.fcf = this.createField(fcfVal, "(Operating Cash Flow - Abs(CapEx)) / Total Revenue", `(${Formatter.num(ocf)} - ${Formatter.num(Math.abs(capex))}) / ${Formatter.num(rev)}`);
      }
    }

    if (mcapVal !== null && mcapVal > 0) {
      const lqrVal = m.lqr.v;
      if (lqrVal !== "UNAVAILABLE" && lqrVal > 0) {
        const svrVal = mcapVal / (lqrVal * 4);
        m.svr = this.createField(svrVal, "Market Cap / (Last Qtr Rev * 4)", `${Formatter.num(mcapVal)} / (${Formatter.num(lqrVal)} * 4)`);
      }
      const prVal = m.pr.v;
      if (prVal !== "NEG" && prVal > 0) {
        const gvrVal = mcapVal / prVal;
        m.gvr = this.createField(gvrVal, "Market Cap / (Projected Revenue)", `${Formatter.num(mcapVal)} / (${Formatter.num(prVal)})`);
      }
      const wprVal = m.wpr.v;
      if (wprVal !== "NEG" && wprVal > 0) {
        const wgvrVal = mcapVal / wprVal;
        m.wgvr = this.createField(wgvrVal, "Market Cap / (Weighted Projected Revenue)", `${Formatter.num(mcapVal)} / (${Formatter.num(wprVal)})`);
      }
    }

    return m;
  }
}

export class FmpApiClient {
  constructor(apiKeys) {
    this.apiKeys = apiKeys;
    this.keyIndex = 0;
    this.lastRequestTime = 0;
    this.baseUrl = "https://financialmodelingprep.com/stable";
  }

  getApiKey() {
    const key = this.apiKeys[this.keyIndex];
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    return key;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async enforceRateLimit() {
    const now = Date.now();
    const timePassed = now - this.lastRequestTime;
    const requiredDelay = 1200;
    if (timePassed < requiredDelay) {
      await this.delay(requiredDelay - timePassed);
    }
    this.lastRequestTime = Date.now();
  }

  async fetchJson(url) {
    logger.debug(`Fetching URL: ${url}`);
    await this.enforceRateLimit();
    const response = await fetch(url);
    const text = await response.text();
    logger.debug(`Received HTTP ${response.status} for ${url}`);
    if (response.status === 429 || text.includes("Limit Reach") || text.includes("Error Message") || text.includes("Not Found")) {
      logger.warn(`API rate limit or error response detected for ${url}. Retrying after delay.`);
      await this.delay(2000);
      return this.fetchJson(url);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      logger.error(`Failed to parse JSON response from ${url}:`, error);
      return null;
    }
  }

  async fetchTickerDataBatch(ticker) {
    const key = this.getApiKey();
    const endpoints = [
      `${this.baseUrl}/income-statement?symbol=${ticker}&limit=5&apikey=${key}`,
      `${this.baseUrl}/income-statement?symbol=${ticker}&period=quarter&limit=10&apikey=${key}`,
      `${this.baseUrl}/cash-flow-statement?symbol=${ticker}&limit=2&apikey=${key}`,
      `${this.baseUrl}/profile?symbol=${ticker}&apikey=${key}`,
      `${this.baseUrl}/ratios-ttm?symbol=${ticker}&apikey=${key}`,
      `${this.baseUrl}/stock-price-change?symbol=${ticker}&apikey=${key}`
    ];

    const responses = {};
    for (const endpoint of endpoints) {
      responses[endpoint] = await this.fetchJson(endpoint);
    }

    return {
      incomeAnnual: responses[endpoints[0]],
      incomeQuarterly: responses[endpoints[1]],
      cashFlow: responses[endpoints[2]],
      profile: responses[endpoints[3]],
      ratios: responses[endpoints[4]],
      priceChange: responses[endpoints[5]]
    };
  }
}

export class DataFetcher {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async fetchAll(inputList, errorLog) {
    logger.info(`Fetching data for ${inputList.length} tickers.`);
    const dataset = {};
    for (const input of inputList) {
      const ticker = input.symbol;
      if (!ticker) continue;
      logger.info(`Fetching ticker data: ${ticker}`);
      const batch = await this.apiClient.fetchTickerDataBatch(ticker);
      const fmpProfile = Array.isArray(batch.profile) && batch.profile.length > 0 ? batch.profile[0] : null;
      const fmpRatios = Array.isArray(batch.ratios) && batch.ratios.length > 0 ? batch.ratios[0] : null;
      const fmpPriceChange = Array.isArray(batch.priceChange) && batch.priceChange.length > 0 ? batch.priceChange[0] : null;
      if (!batch.incomeAnnual && !fmpProfile) {
        const message = `[${ticker}] No API data found or limit hit.`;
        errorLog.push(message);
        logger.warn(message);
      }
      dataset[ticker] = {
        ticker: input.symbol,
        industry: input.industry,
        fmpIncomeAnnual: Array.isArray(batch.incomeAnnual) ? batch.incomeAnnual : [],
        fmpIncomeQuarterly: Array.isArray(batch.incomeQuarterly) ? batch.incomeQuarterly : [],
        fmpCashFlow: Array.isArray(batch.cashFlow) ? batch.cashFlow : [],
        fmpProfile,
        fmpRatios,
        fmpPriceChange
      };
    }
    logger.info("Completed data fetch for all tickers.");
    return dataset;
  }
}

export class OutputWriter {
  static writeJson(filename, payload) {
    const fullPath = path.resolve(filename);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), "utf8");
  }
}

export class DashboardProcessor {
  constructor(apiClient) {
    this.fetcher = new DataFetcher(apiClient);
    this.errors = [];
  }

  async generateDashboard(input, outputPath) {
    logger.info(`Generating dashboard dataset for sheet: ${input.TARGET_SHEET_NAME}`);
    const rawDataMap = await this.fetcher.fetchAll(input.INPUT_DATA, this.errors);
    const rows = [];
    const notes = [];

    for (const inputItem of input.INPUT_DATA) {
      const data = rawDataMap[inputItem.symbol];
      if (!data) {
        logger.warn(`No raw data found for ticker ${inputItem.symbol}; skipping row generation.`);
        continue;
      }
      const metrics = MetricsCalculator.calculateAll(data);
      rows.push(COLUMN_CONFIG.map(col => col.getValue(metrics)));
      notes.push(COLUMN_CONFIG.map(col => col.getNote(metrics)));
      logger.debug(`Generated row for ${inputItem.symbol}`);
    }

    const result = {
      targetSheetName: input.TARGET_SHEET_NAME,
      generatedAt: new Date().toISOString(),
      columns: COLUMN_CONFIG.map(col => ({ header: col.header, note: col.note, format: col.format })),
      rows,
      notes,
      errors: this.errors
    };

    OutputWriter.writeJson(outputPath, result);
    return result;
  }
}
