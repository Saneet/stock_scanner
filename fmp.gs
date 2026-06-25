/**
 * COLUMN CONFIGURATION (CUSTOMIZABLE SEQUENCE)
 */

const COLUMN_CONFIG = [
  { header: "Ticker", note: "Stock Ticker Symbol", format: "string", getValue: d => d.ticker.v, getNote: d => d.ticker.n },
  { header: "Industry", note: "Company Industry", format: "string", getValue: d => d.industry.v, getNote: d => d.industry.n },
  { header: "SVR", note: "Simple Valuation Ratio: Market Cap / (Last quarter revenue * 4)", format: "number", getValue: d => d.svr.v, getNote: d => d.svr.n },
  { header: "GVR", note: "Growth Valuation Ratio: Market Cap / (Projected Revenue)", format: "number", getValue: d => d.gvr.v, getNote: d => d.gvr.n },
  { header: "WGVR", note: "Weighted Growth Valuation Ratio: Market Cap / (Weighted Projected Revenue)", format: "number", getValue: d => d.wgvr.v, getNote: d => d.wgvr.n },
  { header: "Latest QoQ", note: "Sequential quarter-over-quarter revenue growth.", format: "string", getValue: d => d.latestQoq.v, getNote: d => d.latestQoq.n },
  { header: "QtQ Gr", note: "Latest Quarter to Quarter growth (YoY for the quarter) for last 4 quarters.", format: "string", getValue: d => d.qtqStr.v, getNote: d => d.qtqStr.n },
  { header: "YoY Gr", note: "Year over year revenue growth for the last 3 fiscal years.", format: "string", getValue: d => d.yoy.v, getNote: d => d.yoy.n },
  { header: "Margin", note: "Gross Margin for the last 4 quarters.", format: "string", getValue: d => d.margin.v, getNote: d => d.margin.n },
  { header: "FCF Yld", note: "Free Cash Flow Yield.", format: "percent", getValue: d => d.fcf.v, getNote: d => d.fcf.n },
  { header: "MCap", note: "Market Capitalization", format: "large_currency", getValue: d => d.mcap.v, getNote: d => d.mcap.n },
  { header: "LQR", note: "Last Quarter Revenue", format: "large_currency", getValue: d => d.lqr.v, getNote: d => d.lqr.n },
  { header: "AQG", note: "Average Quarter to Quarter growth of the last 4 quarters.", format: "percent", getValue: d => d.aqg.v, getNote: d => d.aqg.n },
  { header: "WAQG", note: "Weighted Avg QtQ growth (0.4 for latest, 0.3, 0.2, 0.1 for oldest).", format: "percent", getValue: d => d.waqg.v, getNote: d => d.waqg.n },
  { header: "PR", note: "Projected Revenue: Last 4 quarter revenue * (1 + Avg QtQ growth)", format: "large_currency", getValue: d => d.pr.v, getNote: d => d.pr.n },
  { header: "WPR", note: "Weighted Projected Revenue: Last 4 quarter revenue * (1 + Weighted Avg QtQ growth)", format: "large_currency", getValue: d => d.wpr.v, getNote: d => d.wpr.n },
  { header: "Price", note: "Current Stock Price", format: "currency", getValue: d => d.price.v, getNote: d => d.price.n },
  { header: "% Change", note: "1W, 1M, 3M, 1Y % Change", format: "string", getValue: d => d.pctChange.v, getNote: d => d.pctChange.n },
  { header: "P/S", note: "Price to Sales Ratio (TTM)", format: "number", getValue: d => d.ps.v, getNote: d => d.ps.n },
  { header: "P/E", note: "Price to Earnings Ratio (TTM)", format: "number", getValue: d => d.pe.v, getNote: d => d.pe.n }
];

/**
 * UTILITIES
 */

class Utils {
  static parseNum(val) {
    if (val === "None" || val === null || val === undefined) return 0;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  }
}

class Formatter {
  static toPercentStr(value) { return value === "UNAVAILABLE" ? value : `${(value * 100).toFixed(2)}%`; }
  static toDirectPercentStr(value) {
    if (value === null || value === undefined || isNaN(value)) return "N/A";
    return `${parseFloat(value).toFixed(2)}%`;
  }
  static num(val) { 
    if (val === "UNAVAILABLE" || val === "NEG") return val;
    return Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 }); 
  }
  static extractYearShort(dateStr) {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? "??" : String(date.getFullYear()).slice(-2);
  }
  static buildQuarterLabel(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "??Q?";
    return `${String(date.getFullYear()).slice(-2)}Q${Math.ceil((date.getMonth() + 1) / 3)}`;
  }
  static makeNote(formula, values) {
    if (!formula && !values) return "";
    return `Formula: ${formula}\nValues: ${values}`;
  }
}

/**
 * API CLIENTS (DATA FETCHING)
 */

class FmpApiClient {
  constructor(apiKeys, fetcher = UrlFetchApp) {
    this.apiKeys = apiKeys;
    this.keyIndex = 0;
    this.lastRequestTime = 0;
    this.fetcher = fetcher;
  }

  getApiKey() {
    const key = this.apiKeys[this.keyIndex];
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    return key;
  }

  enforceRateLimit() {
    const now = new Date().getTime();
    const timePassed = now - this.lastRequestTime;
    const requiredDelay = 250; 
    if (timePassed < requiredDelay) Utilities.sleep(requiredDelay - timePassed);
    this.lastRequestTime = new Date().getTime();
  }

  fetchTickerDataBatch(ticker) {
    this.enforceRateLimit();
    const key = this.getApiKey();

    const endpoints = [
      `https://financialmodelingprep.com/stable/income-statement?symbol=${ticker}&limit=5&apikey=${key}`,
      `https://financialmodelingprep.com/stable/income-statement?symbol=${ticker}&period=quarter&limit=10&apikey=${key}`,
      `https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${ticker}&limit=2&apikey=${key}`,
      `https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${key}`,
      `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${ticker}&apikey=${key}`,
      `https://financialmodelingprep.com/stable/stock-price-change?symbol=${ticker}&apikey=${key}`,
      `https://financialmodelingprep.com/api/v3/quote/${ticker}?apikey=${key}`,
      `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=10&apikey=${key}`
    ];

    const requests = endpoints.map(url => ({
      url: url,
      method: 'get',
      muteHttpExceptions: true
    }));

    let responses = this.fetcher.fetchAll(requests);

    // Single retry block in case the batch hits a 429 rate limit
    if (responses.some(r => r.getResponseCode() === 429)) {
      Utilities.sleep(2000); 
      responses = this.fetcher.fetchAll(requests);
    }

    const parse = (res) => {
      if (!res || res.getResponseCode() !== 200) return null;
      const txt = res.getContentText();
      if (txt.includes("Limit Reach") || txt.includes("Error Message") || txt.includes("Not Found")) return null;
      try { return JSON.parse(txt); } catch(e) { return null; }
    };

    return {
      incomeAnnual: parse(responses[0]),
      incomeQuarterly: parse(responses[1]),
      cashFlow: parse(responses[2]),
      profile: parse(responses[3]),
      ratios: parse(responses[4]),
      priceChange: parse(responses[5]),
      quote: parse(responses[6]),
      historical: parse(responses[7])
    };
  }
}

class DataFetcher {
  constructor() {
    this.fmp = new FmpApiClient(CONSTANTS.FMP_API_KEYS);
  }

  fetchAll(inputList, errorLog) {
    Logger.log("Fetching FMP Data...");
    const dataset = {};

    inputList.forEach(input => {
      const ticker = input.symbol;
      if (!ticker) return; 
      Logger.log(`Processing: ${ticker}`);
      
      const batch = this.fmp.fetchTickerDataBatch(ticker);

      let recentPrices = [];
      if (batch.historical && batch.historical.historical) {
        const series = batch.historical.historical;
        recentPrices = series.slice(0, 10).map(d => ({ date: d.date, close: Utils.parseNum(d.close) }));
      }

      // Unwrap arrays for endpoints that return array wrappers
      let fmpProfile = (batch.profile && batch.profile.length > 0) ? batch.profile[0] : null;
      let fmpQuote = (batch.quote && batch.quote.length > 0) ? batch.quote[0] : null;
      let fmpRatios = (batch.ratios && batch.ratios.length > 0) ? batch.ratios[0] : null;
      let fmpPriceChange = (batch.priceChange && batch.priceChange.length > 0) ? batch.priceChange[0] : null;

      if (!batch.incomeAnnual && !fmpProfile && recentPrices.length === 0) {
        errorLog.push(`[${ticker}] No API data found or Limit Hit.`);
      }

      dataset[ticker] = { 
        ticker: input.symbol, 
        industry: input.industry, 
        fmpIncomeAnnual: Array.isArray(batch.incomeAnnual) ? batch.incomeAnnual : [], 
        fmpIncomeQuarterly: Array.isArray(batch.incomeQuarterly) ? batch.incomeQuarterly : [], 
        fmpCashFlow: Array.isArray(batch.cashFlow) ? batch.cashFlow : [], 
        fmpProfile, fmpQuote, fmpRatios, fmpPriceChange, recentPrices 
      };
    });
    
    return dataset;
  }
}

/**
 * CALCULATORS (Business Logic)
 */

class MetricsCalculator {
  static createField(value, formula = "", values = "") {
    return { v: value, n: Formatter.makeNote(formula, values) };
  }

  static calculateAll(data) {
    const { ticker, industry, fmpIncomeAnnual, fmpIncomeQuarterly, fmpCashFlow, fmpProfile, fmpQuote, fmpRatios, fmpPriceChange, recentPrices } = data;
    
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

    // Ticker Note Profile Info (Company Name, CEO, Country, ADR, Years Public)
    let tickerNoteStr = "User Input";
    if (fmpProfile) {
      const name = fmpProfile.companyName || "N/A";
      const ceo = fmpProfile.ceo || "N/A";
      const country = fmpProfile.country || "N/A";
      const isAdr = fmpProfile.isAdr !== undefined ? fmpProfile.isAdr : "N/A";
      
      let yearsPublic = "N/A";
      if (fmpProfile.ipoDate) {
        const ipo = new Date(fmpProfile.ipoDate);
        if (!isNaN(ipo.getTime())) {
          const diffMs = Date.now() - ipo.getTime();
          yearsPublic = (diffMs / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
        }
      }
      
      tickerNoteStr = `${name}\nCEO: ${ceo}\nCountry: ${country}\nADR: ${isAdr}\nYears Public: ${yearsPublic}`;
      m.ticker = this.createField(ticker, "API: Profile", tickerNoteStr);
    }

    // 1. Price Metrics
    let currentPrice = null;
    if (fmpQuote && fmpQuote.price) {
      currentPrice = Utils.parseNum(fmpQuote.price);
      m.price = this.createField(currentPrice, "API: Quote [price]", Formatter.num(currentPrice));
    } else if (fmpProfile && fmpProfile.price) {
      currentPrice = Utils.parseNum(fmpProfile.price);
      m.price = this.createField(currentPrice, "API: Profile [price]", Formatter.num(currentPrice));
    } else if (recentPrices && recentPrices.length > 0) {
      currentPrice = recentPrices[0].close;
      m.price = this.createField(currentPrice, "API: Historical Price (Latest)", Formatter.num(currentPrice));
    }
    
    // % Change logic (1W, 1M, 3M, 1Y)
    if (fmpPriceChange && fmpPriceChange["5D"] !== undefined && fmpPriceChange["5D"] !== null) {
      const w1 = Formatter.toDirectPercentStr(fmpPriceChange["5D"]);
      const m1 = Formatter.toDirectPercentStr(fmpPriceChange["1M"]);
      const m3 = Formatter.toDirectPercentStr(fmpPriceChange["3M"]);
      const y1 = Formatter.toDirectPercentStr(fmpPriceChange["1Y"]);
      
      const pctStr = `1W: ${w1}\n1M: ${m1}\n3M: ${m3}\n1Y: ${y1}`;
      const noteStr = `Raw values:\n1W (5D): ${fmpPriceChange["5D"]}\n1M: ${fmpPriceChange["1M"]}\n3M: ${fmpPriceChange["3M"]}\n1Y: ${fmpPriceChange["1Y"]}`;
      
      m.pctChange = this.createField(pctStr, "API: Stock Price Change", noteStr);
    } else if (recentPrices && recentPrices.length > 0 && currentPrice) {
      // Fallback manual calculation for 1W if the specific endpoint fails
      const targetDateMs = new Date(recentPrices[0].date).getTime() - (7 * 24 * 60 * 60 * 1000);
      let pastPrice = recentPrices.find(p => new Date(p.date).getTime() <= targetDateMs)?.close;
      if (!pastPrice && recentPrices.length > 5) pastPrice = recentPrices[5].close;
      
      if (pastPrice) {
        const wChg = (currentPrice - pastPrice) / pastPrice;
        m.pctChange = this.createField(`1W: ${Formatter.toPercentStr(wChg)}\n1M: N/A\n3M: N/A\n1Y: N/A`, "(Current Price - 7 Day Old Price) / 7 Day Old Price", `1W Fallback: (${Formatter.num(currentPrice)} - ${Formatter.num(pastPrice)}) / ${Formatter.num(pastPrice)}`);
      }
    }

    // 2. Market Cap, P/S, P/E
    let mcapVal = null;
    if (fmpProfile) {
      if (fmpProfile.marketCap || fmpProfile.mktCap) {
        mcapVal = Utils.parseNum(fmpProfile.marketCap || fmpProfile.mktCap);
        m.mcap = this.createField(mcapVal, "API: Profile [marketCap]", Formatter.num(mcapVal));
      }
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
    } else if (fmpQuote && fmpQuote.pe) {
      const peVal = Utils.parseNum(fmpQuote.pe);
      m.pe = this.createField(peVal, "API: Quote [pe]", Formatter.num(peVal));
    }

    // 3. Income Statement Metrics (Quarterly)
    if (fmpIncomeQuarterly && fmpIncomeQuarterly.length > 0) {
      const q = fmpIncomeQuarterly;
      const lqrVal = Utils.parseNum(q[0].revenue);
      m.lqr = this.createField(lqrVal, "API: Income Statement [Quarterly revenue 0]", Formatter.num(lqrVal));

      // Latest QoQ & Margins
      const qoqArr = [], qoqNotes = [];
      const marginArr = [], marginNotes = [];
      
      for (let i = 0; i < Math.min(q.length, 5); i++) {
        const rev = Utils.parseNum(q[i].revenue);
        const gross = Utils.parseNum(q[i].grossProfit);
        const lbl = Formatter.buildQuarterLabel(q[i].date);
        
        if (rev !== 0 && i < 4) {
          marginArr.push(`${lbl}: ${Formatter.toPercentStr(gross/rev)}`);
          marginNotes.push(`${lbl} => ${Formatter.num(gross)} / ${Formatter.num(rev)}`);
        }
        
        if (q[i+1] && i < 4) {
          const prevRev = Utils.parseNum(q[i+1].revenue);
          const prevLbl = Formatter.buildQuarterLabel(q[i+1].date);
          if (prevRev !== 0) {
            qoqArr.push(`${lbl}: ${Formatter.toPercentStr((rev-prevRev)/prevRev)}`);
            qoqNotes.push(`${lbl} over ${prevLbl} => (${Formatter.num(rev)} - ${Formatter.num(prevRev)}) / ${Formatter.num(prevRev)}`);
          }
        }
      }
      
      if (qoqArr.length > 0) m.latestQoq = this.createField(qoqArr.join('\n'), "(Current Q Rev - Prior Q Rev) / Prior Q Rev", qoqNotes.join('\n'));
      if (marginArr.length > 0) m.margin = this.createField(marginArr.join('\n'), "Gross Profit / Total Revenue", marginNotes.join('\n'));

      // Quarter-to-Quarter (QtQ YoY) logic
      if (q.length >= 8) {
        const qtqNum = [], qtqLabels = [], qtqNotesArr = [];
        let ttmRev = 0;
        
        for (let i = 0; i < 4; i++) {
          const curr = Utils.parseNum(q[i].revenue);
          const prior = Utils.parseNum(q[i+4].revenue);
          ttmRev += curr;
          
          if (prior !== 0) {
            const growth = (curr - prior) / prior;
            qtqNum.push(growth);
            const lbl = `${Formatter.buildQuarterLabel(q[i].date)}`;
            const lblNote = `${Formatter.buildQuarterLabel(q[i].date)} over ${Formatter.buildQuarterLabel(q[i+4].date)}`;
            qtqLabels.push(lbl);
            qtqNotesArr.push(`${lblNote} => (${Formatter.num(curr)} - ${Formatter.num(prior)}) / ${Formatter.num(prior)}`);
          } else {
            qtqNum.push(null);
          }
        }

        if (qtqNum.every(x => x !== null)) {
          const qtqStrForm = qtqLabels.map((lbl, i) => `${lbl}: ${Formatter.toPercentStr(qtqNum[i])}`).join('\n');
          m.qtqStr = this.createField(qtqStrForm, "(Current Q Rev - Prior Year Same Q Rev) / Prior Year Same Q Rev", qtqNotesArr.join('\n'));
          
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

    // 4. YoY Annual Growth
    if (fmpIncomeAnnual && fmpIncomeAnnual.length > 1) {
      const a = fmpIncomeAnnual;
      const yoyArr = [], yoyNotes = [];
      for (let i = 0; i < Math.min(a.length - 1, 3); i++) {
        const c = Utils.parseNum(a[i].revenue);
        const p = Utils.parseNum(a[i+1].revenue);
        if (p !== 0) {
          const lbl = `FY${Formatter.extractYearShort(a[i].date)}`;
          yoyArr.push(`${lbl}: ${Formatter.toPercentStr((c-p)/p)}`);
          yoyNotes.push(`${lbl} => (${Formatter.num(c)} - ${Formatter.num(p)}) / ${Formatter.num(p)}`);
        }
      }
      if (yoyArr.length > 0) m.yoy = this.createField(yoyArr.join('\n'), "(Current FY Rev - Prior FY Rev) / Prior FY Rev", yoyNotes.join('\n'));
    }

    // 5. FCF Yield
    if (fmpCashFlow && fmpCashFlow.length > 0 && fmpIncomeAnnual && fmpIncomeAnnual.length > 0) {
      const ocf = Utils.parseNum(fmpCashFlow[0].operatingCashFlow);
      const capex = Utils.parseNum(fmpCashFlow[0].capitalExpenditure); 
      const rev = Utils.parseNum(fmpIncomeAnnual[0].revenue);
      if (rev !== 0) {
        const fcfVal = (ocf - Math.abs(capex)) / rev;
        m.fcf = this.createField(fcfVal, "(Operating Cash Flow - Abs(CapEx)) / Total Revenue", `(${Formatter.num(ocf)} - ${Formatter.num(Math.abs(capex))}) / ${Formatter.num(rev)}`);
      }
    }

    // 6. Valuations
    if (mcapVal !== null && mcapVal > 0) {
      const lqrVal = m.lqr.v;
      if (lqrVal !== "UNAVAILABLE" && lqrVal > 0) {
        const svrVal = mcapVal / (lqrVal * 4);
        m.svr = this.createField(svrVal, "Market Cap / (Last Qtr Rev * 4)", `${Formatter.num(mcapVal)} / (${Formatter.num(lqrVal)} * 4)`);
      }
      
      const prVal = m.pr.v;
      if (prVal !== "NEG" && prVal > 0) {
        const gvrVal = mcapVal / (prVal);
        m.gvr = this.createField(gvrVal, "Market Cap / (Projected Revenue)", `${Formatter.num(mcapVal)} / (${Formatter.num(prVal)})`);
      }
      
      const wprVal = m.wpr.v;
      if (wprVal !== "NEG" && wprVal > 0) {
        const wgvrVal = mcapVal / (wprVal);
        m.wgvr = this.createField(wgvrVal, "Market Cap / (Weighted Projected Revenue)", `${Formatter.num(mcapVal)} / (${Formatter.num(wprVal)})`);
      }
    }

    return m;
  }
}

/**
 * APPLICATION & SHEET WRITER
 */

class DashboardProcessor {
  constructor() {
    this.fetcher = new DataFetcher();
    this.errors = [];
  }

  generateDashboard() {
    const rawDataMap = this.fetcher.fetchAll(CONSTANTS.INPUT_DATA, this.errors);
    const rowsValues = [];
    const rowsNotes = [];

    CONSTANTS.INPUT_DATA.forEach((input) => {
      try {
        const data = rawDataMap[input.symbol];
        if (data) {
          const metrics = MetricsCalculator.calculateAll(data);
          const rowData = COLUMN_CONFIG.map(col => col.getValue(metrics));
          const rowNote = COLUMN_CONFIG.map(col => col.getNote(metrics));
          
          rowsValues.push(rowData);
          rowsNotes.push(rowNote);
        }
      } catch (e) {
        this.errors.push(`[${input.symbol}] Processing Error: ${e.message}`);
      }
    });

    const writer = new SheetWriter();
    writer.writeToSheet(rowsValues, rowsNotes, this.errors);
  }
}

class SheetWriter {
  writeToSheet(rowsValues, rowsNotes, errors) {
    const targetSpreadsheet = SpreadsheetApp.openById(CONSTANTS.SPREADSHEET_ID);
    let sheet = targetSpreadsheet.getSheetByName(CONSTANTS.TARGET_SHEET_NAME);
    
    if (!sheet) {
      sheet = targetSpreadsheet.insertSheet(CONSTANTS.TARGET_SHEET_NAME);
    } else {
      sheet.clear();
      const bandings = sheet.getBandings();
      bandings.forEach(banding => banding.remove());
      sheet.clearNotes();
      sheet.getRange("A1:Z100").clearDataValidations();
      
      // REMOVE THE OLD FILTER IF IT EXISTS
      if (sheet.getFilter()) {
        sheet.getFilter().remove();
      }
    }

    const headers = COLUMN_CONFIG.map(c => c.header);
    const headerNotes = COLUMN_CONFIG.map(c => c.note);

    const HEADER_ROW = 1;                     
    const DATA_START_ROW = 2;                 
    const TOTAL_DATA_ROWS = rowsValues.length;

    // Write Headers and Column Description Notes
    sheet.getRange(HEADER_ROW, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.getRange(HEADER_ROW, 1, 1, headers.length).setNotes([headerNotes]);

    // Write Data, Cell Calculation Notes, and Apply Dynamic Formatting
    if (TOTAL_DATA_ROWS > 0) {
      const dataRange = sheet.getRange(DATA_START_ROW, 1, TOTAL_DATA_ROWS, headers.length);
      dataRange.setValues(rowsValues);
      dataRange.setNotes(rowsNotes); // Injects the formula calculations directly into cell notes
      
      COLUMN_CONFIG.forEach((colDef, idx) => {
        const colNum = idx + 1;
        const range = sheet.getRange(DATA_START_ROW, colNum, TOTAL_DATA_ROWS, 1);
        
        switch(colDef.format) {
          case "currency": range.setNumberFormat("$#,##0.00"); break;
          case "percent": range.setNumberFormat("0.00%"); break;
          case "large_currency": range.setNumberFormat('[>=1000000000000]0.00,,,,"T";[>=1000000000]0.00,,,"B";0.00,,"M"'); break;
          case "number": range.setNumberFormat("0.00"); break;
        }
      });
    }

    sheet.getDataRange().applyRowBanding(SpreadsheetApp.BandingTheme.GREY);

    sheet.setFrozenRows(1); 
    sheet.setFrozenColumns(1);
    sheet.getRange(1, 1, TOTAL_DATA_ROWS + 1, headers.length).createFilter();
    this.autoResizeWithLimits(sheet, headers.length);

    // Print Error Logs below the table
    const errorStartRow = DATA_START_ROW + Math.max(TOTAL_DATA_ROWS, 1) + 2;
    const logText = errors.length > 0 ? errors.join("\n") : "No errors or warnings.";
    sheet.getRange(errorStartRow, 1).setValue("Errors & Warnings:\n" + logText)
         .setFontColor(errors.length > 0 ? "red" : "gray")
         .setFontWeight("bold");
  }

  autoResizeWithLimits(sheet, visibleCols) {
    SpreadsheetApp.flush();
    sheet.autoResizeColumns(1, visibleCols);
    var minWidth = 80, maxWidth = 300, padding = 15;

    for (var col = 1; col <= visibleCols; col++) {
      var width = sheet.getColumnWidth(col) + padding;
      if (width < minWidth) sheet.setColumnWidth(col, minWidth);
      else if (width > maxWidth) {
        sheet.setColumnWidth(col, maxWidth);
        sheet.getRange(1, col, sheet.getLastRow(), 1).setWrap(true);
      } else sheet.setColumnWidth(col, width);
    }
  }
}

/**
 * MAIN EXECUTION
 */

function generateFinancialDashboard() {
  Logger.log("Starting Financial Dashboard Generation...");
  const app = new DashboardProcessor();
  app.generateDashboard();
  Logger.log("Finished Dashboard Generation.");
}
