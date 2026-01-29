# Solana Tax Analyzer

Analyze a Solana wallet’s on-chain activity and open every trade on Solscan for tax review and profit calculation.

## What it does

- **Paste a SOL address** – Enter any Solana wallet address.
- **Fetch activity** – Loads recent transactions from Solana mainnet (last 200 by default).
- **List trades** – Shows swaps and token transfers (in/out) with amounts and dates.
- **Open on Solscan** – Each row links to the transaction on [solscan.com](https://solscan.com) so you can verify and use it for tax reporting.

## Run locally

1. Install dependencies:
   ```bash
   cd solana-tax-analyzer && npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000), paste a wallet address, and click **Analyze**.

## Optional: dedicated RPC

The app uses the public Solana RPC by default. For more traffic or faster responses, set a dedicated RPC in `.env.local`:

```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api_key=YOUR_KEY
```

Copy `.env.example` to `.env.local` and fill in the URL.

## Tax use

- Use the table to see **all trades** (swaps) and **transfers** for the wallet.
- Click the transaction link to open it on Solscan and confirm details.
- For **USD values and cost basis**, use Solscan’s export or a Solana-capable tax tool; this app focuses on listing activity and linking to Solscan for verification.

## Tech

- **Next.js 14** (App Router) + TypeScript + Tailwind
- **@solana/web3.js** – `getSignaturesForAddress` + `getParsedTransaction` to get and parse transactions
- **Solscan** – Links only; no scraping or Solscan API key required
