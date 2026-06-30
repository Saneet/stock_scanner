# Stock Scanner

This repository runs a stock scanner using data from FinancialModelingPrep and updates Google Sheets on each execution when configured.

## Project structure

- `src/constants.js` — configuration for API keys and stock lists.
- `src/fmp.js` — FinancialModelingPrep API client and calculation logic.
- `src/index.js` — main runner that executes the scanner for AI and other stock groups.
- `.github/workflows/stock-scanner-hourly.yml` — GitHub Actions workflow scheduled to run hourly.

## Requirements

- Node.js 18 or newer
- `FMP_API_KEYS` environment variable containing one or more FinancialModelingPrep API keys

## Local usage

1. Install dependencies (if you add any later):

```bash
npm install
```

2. Set your API key(s):

```bash
export FMP_API_KEYS="your_api_key_here"
```

3. Run the scanner:

```bash
npm run fetch
```

4. If Google Sheets is configured, results are written directly to the target sheet(s).

## GitHub Actions

The workflow `.github/workflows/stock-scanner-hourly.yml` is configured to run every hour.

### Required secret

- `FMP_API_KEYS`

Set this in your repository settings under `Settings > Secrets and variables > Actions`.

If you need to support multiple keys, separate them with commas.

## Notes

- The runner does not persist local JSON files by default; it updates Google Sheets when properly configured.
- To write to Google Sheets, set `SPREADSHEET_ID`, and use a Google service account with `GOOGLE_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`.
- Share the spreadsheet with the service account email, then set the secret `GOOGLE_SERVICE_ACCOUNT_KEY` in GitHub Actions.
- Update `src/constants.js` to change the stock lists or target sheet names if needed.
