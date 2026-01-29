export interface TokenAmount {
  mint: string;
  symbol?: string;
  amount: number;
  amountRaw: string;
  decimals: number;
}

export interface Trade {
  signature: string;
  blockTime: number;
  date: string;
  type: "swap" | "transfer_in" | "transfer_out";
  from: TokenAmount;
  to: TokenAmount;
  solscanUrl: string;
  feeLamports?: number;
  involvedAddresses?: string[]; // Other addresses involved in this transaction
}

// Individual buy or sell for a token
export interface TokenTransaction {
  signature: string;
  date: string;
  blockTime: number;
  type: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  solscanUrl: string;
  solBalanceAfter?: number; // SOL balance after this transaction
}

// SOL deposit or withdrawal (not a swap)
export interface SolTransaction {
  signature: string;
  date: string;
  blockTime: number;
  type: "deposit" | "withdrawal" | "cashback";
  amount: number;
  solscanUrl: string;
  solBalanceAfter?: number;
  label?: string; // e.g., "AIRDROP", etc.
  sourceAddress?: string; // Address that sent/received the SOL
}

// Unified trade showing full round-trip for a token
export interface UnifiedTrade {
  tokenMint: string;
  totalSolSpent: number;      // Total SOL spent buying
  totalSolReceived: number;   // Total SOL received selling
  totalTokensBought: number;
  totalTokensSold: number;
  tokensRemaining: number;    // Tokens still held
  pnl: number;                // Profit/Loss in SOL (received - spent)
  pnlPercent: number;         // PNL as percentage
  realized: boolean;          // True if all tokens sold
  transactions: TokenTransaction[];
  firstBuyDate: string;
  lastActivityDate: string;
}

export interface AnalysisResult {
  address: string;
  trades: Trade[];
  unifiedTrades: UnifiedTrade[];
  solTransactions: SolTransaction[];
  totalCount: number;
  totalTransactions: number;
  totalPnl: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalCashback: number;
  solscanProfileUrl: string;
  error?: string;
}
