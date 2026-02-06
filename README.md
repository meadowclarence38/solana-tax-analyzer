# Solana Tax Analyzer

Analyze a Solana wallet’s on-chain activity for tax review: trades, deposits, withdrawals, PNL, and net flow. Interactive charts, filters, and export to CSV, JSON, or PDF.

## What it does

- **Wallet analysis** – Enter any Solana address and click **Analyze**. The app fetches transactions from mainnet and parses swaps, deposits, withdrawals, and cashback.
- **Batch analysis** – Add multiple wallet addresses to analyze them all at once. Export results for all wallets in one PDF report with separate sections per wallet.
- **Reporting period** – Choose a date range (This month, Last month, This year, 2024, 2025, or Custom). **Choosing a date range speeds up analysis** by fetching and parsing only that period.
- **Summary** – Trading PNL, Deposits, Withdrawals, Cashback, and **Net Flow** (Deposits + Cashback − Withdrawals + PNL = total SOL change over the period).
- **Charts** – Cumulative PNL over time, trade volume by token, gains vs losses (pie). **Filters** – by token and min SOL; cost basis (FIFO/LIFO/HIFO) and jurisdiction (US/EU/Other).
- **Token tickers** – Trades are shown by token symbol (e.g. BONK, RAY) where possible, with a fallback to shortened mint; same in the PDF report.
- **Trades & transfers** – Tables for trading activity by token and SOL deposits/withdrawals, with links to [Solscan](https://solscan.com) for verification.
- **Export PDF** – Print-friendly tax report: summary, trading activity by token, and deposits/withdrawals. Use the browser’s Print → Save as PDF.
- **Export CSV** – Download summary, trades, and transfers as CSV for use in spreadsheets or tax software.
- **SOL price** – Optional USD values via Binance SOL/USDT (display only).

## Run locally

1. Install dependencies:
   ```bash
   cd solana-tax-analyzer && npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000), paste a wallet address, optionally set a reporting period, and click **Analyze**.

## Optional: dedicated RPC

The app uses the public Solana RPC by default. For more traffic or faster responses, set a dedicated RPC in `.env.local`:

```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api_key=YOUR_KEY
```

Copy `.env.example` to `.env.local` and fill in the URL.

## Tax use

- Use the **reporting period** to limit analysis to a tax year or month; this also reduces fetch time.
- Review **Net Flow** and **Trading PNL** with the summary and tables.
- **Export PDF** or **Export CSV** for your records or to feed into another tax tool.
- For detailed USD cost basis, combine with Solscan or a Solana-capable tax service; this app focuses on SOL amounts and linking to Solscan.

## Tech

- **Next.js 14** (App Router) + TypeScript + Tailwind
- **Recharts** – PNL over time, volume by token, gains/losses pie
- **@solana/web3.js** – `getSignaturesForAddress` (with date-based early stop) + `getParsedTransaction`
- **Solana Labs token list** – Mint → symbol for display
- **Solscan** – Links only; no Solscan API key required

## Open source

[GitHub](https://github.com/meadowclarence38/solana-tax-analyzer) – contributions welcome. Not tax advice; consult a professional for your jurisdiction.
