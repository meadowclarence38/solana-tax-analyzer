import { Connection, PublicKey } from "@solana/web3.js";
import type { Trade, TokenAmount, UnifiedTrade, TokenTransaction, SolTransaction } from "@/types/analyze";

const SOLSCAN_TX = "https://solscan.io/tx/";
const SOLSCAN_ACCOUNT = "https://solscan.io/account/";
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const SIGNATURES_PER_REQUEST = 1000; // Max allowed by Solana RPC
const CONCURRENCY = 5; // Reduced to avoid rate limits
const BATCH_DELAY_MS = 200; // Delay between batches
const MIN_TRADE_VALUE_SOL = 0.01; // Minimum value filter

// Helper to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit = error instanceof Error && 
        (error.message.includes('429') || error.message.includes('rate'));
      
      if (attempt === maxRetries || !isRateLimit) {
        throw error;
      }
      
      const waitTime = baseDelay * Math.pow(2, attempt);
      console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}...`);
      await delay(waitTime);
    }
  }
  throw new Error('Max retries exceeded');
}

interface TokenBalanceEntry {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount: string; decimals: number; uiAmount: number | null };
}

interface ParsedTxMeta {
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: TokenBalanceEntry[];
  postTokenBalances?: TokenBalanceEntry[];
  err: unknown;
}

interface ParsedTx {
  slot: number;
  blockTime: number | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string } | string>;
    };
  };
  meta: ParsedTxMeta | null;
}

function getPubkey(key: { pubkey: string | { toString(): string } } | string): string {
  if (typeof key === "string") return key;
  const pubkey = key.pubkey;
  return typeof pubkey === "string" ? pubkey : pubkey.toString();
}

function parseTokenAmount(amount: string, decimals: number): number {
  const n = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  return Number(n) / Number(divisor);
}

// Wrapped SOL mint
const WSOL_MINT = "So11111111111111111111111111111111111111112";
// Minimum SOL change to consider (filters out small fee-only changes)
const MIN_SOL_CHANGE = 0.001;

// Known addresses with labels
const KNOWN_ADDRESSES: Record<string, string> = {
  "AxiomRXZAq1Jgjj9pHmNqVP7Lhu67wLXZJZbaK87TTSk": "CASHBACK",
  // Add more known addresses here as needed
};

function extractTradesFromTx(
  sig: string,
  wallet: string,
  parsed: ParsedTx | null
): Trade[] {
  if (!parsed?.meta || parsed.meta.err) return [];
  const { transaction, meta, blockTime } = parsed;
  const accountKeys = transaction.message.accountKeys;
  const walletIndex = accountKeys.findIndex(
    (k) => getPubkey(k) === wallet
  );
  if (walletIndex === -1) return [];

  const preBalances = meta.preBalances ?? [];
  const postBalances = meta.postBalances ?? [];
  const solDelta =
    (postBalances[walletIndex] ?? 0) - (preBalances[walletIndex] ?? 0);
  const solChange = solDelta / 1e9;

  // Get ALL token balances from the transaction
  const allPreToken = meta.preTokenBalances ?? [];
  const allPostToken = meta.postTokenBalances ?? [];
  
  // Get token balances owned by the wallet (explicit owner match)
  // Owner might be string or object, so convert to string for comparison
  const getOwner = (t: TokenBalanceEntry): string => {
    if (!t.owner) return "";
    return typeof t.owner === "string" ? t.owner : String(t.owner);
  };
  
  const preToken = allPreToken.filter((t) => getOwner(t) === wallet);
  const postToken = allPostToken.filter((t) => getOwner(t) === wallet);
  
  // Also check for token accounts where owner might be undefined but accountIndex
  // corresponds to the wallet (some programs don't set owner)
  const preTokenByIndex = allPreToken.filter(
    (t) => !t.owner && t.accountIndex === walletIndex
  );
  const postTokenByIndex = allPostToken.filter(
    (t) => !t.owner && t.accountIndex === walletIndex
  );

  // Aggregate token changes by mint (not by account index)
  const mintDeltas = new Map<string, { amount: number; decimals: number }>();

  // Helper to process token balance changes
  function processTokenChanges(pre: TokenBalanceEntry[], post: TokenBalanceEntry[]) {
    const allAccountIndices = new Set<number>();
    for (const t of [...pre, ...post]) {
      allAccountIndices.add(t.accountIndex);
    }

    for (const accountIndex of allAccountIndices) {
      const preEntry = pre.find((p) => p.accountIndex === accountIndex);
      const postEntry = post.find((p) => p.accountIndex === accountIndex);
      
      const mint = postEntry?.mint ?? preEntry?.mint;
      if (!mint) continue;
      
      const decimals = postEntry?.uiTokenAmount?.decimals ?? preEntry?.uiTokenAmount?.decimals ?? 0;
      const preAmount = preEntry?.uiTokenAmount?.amount ?? "0";
      const postAmount = postEntry?.uiTokenAmount?.amount ?? "0";
      
      const preVal = parseTokenAmount(preAmount, decimals);
      const postVal = parseTokenAmount(postAmount, decimals);
      const delta = postVal - preVal;
      
      if (delta !== 0) {
        const existing = mintDeltas.get(mint);
        if (existing) {
          existing.amount += delta;
        } else {
          mintDeltas.set(mint, { amount: delta, decimals });
        }
      }
    }
  }

  // Process both owner-matched and index-matched token balances
  processTokenChanges(preToken, postToken);
  processTokenChanges(preTokenByIndex, postTokenByIndex);

  const outs: TokenAmount[] = [];
  const ins: TokenAmount[] = [];

  // Always check native SOL change first (this is the most reliable)
  // Fee threshold: typical fee is ~0.000005 SOL, so anything > 0.001 is significant
  const hasSignificantSolChange = Math.abs(solChange) > MIN_SOL_CHANGE;
  
  // Check for wrapped SOL changes in token balances
  const wsolDelta = mintDeltas.get(WSOL_MINT);
  
  // If we have WSOL changes, use those
  if (wsolDelta && Math.abs(wsolDelta.amount) > MIN_SOL_CHANGE) {
    if (wsolDelta.amount < 0) {
      outs.push({
        mint: WSOL_MINT,
        amount: Math.abs(wsolDelta.amount),
        amountRaw: String(Math.round(Math.abs(wsolDelta.amount) * 1e9)),
        decimals: 9,
      });
    } else {
      ins.push({
        mint: WSOL_MINT,
        amount: wsolDelta.amount,
        amountRaw: String(Math.round(wsolDelta.amount * 1e9)),
        decimals: 9,
      });
    }
    mintDeltas.delete(WSOL_MINT);
  }
  // If no WSOL changes but significant native SOL change, use native SOL
  else if (hasSignificantSolChange) {
    if (solChange < -MIN_SOL_CHANGE) {
      outs.push({
        mint: WSOL_MINT,
        amount: Math.abs(solChange),
        amountRaw: String(Math.abs(solDelta)),
        decimals: 9,
      });
    } else if (solChange > MIN_SOL_CHANGE) {
      ins.push({
        mint: WSOL_MINT,
        amount: solChange,
        amountRaw: String(solDelta),
        decimals: 9,
      });
    }
  }

  // Process other token changes
  for (const [mint, { amount, decimals }] of mintDeltas) {
    const ta: TokenAmount = {
      mint,
      amount: Math.abs(amount),
      amountRaw: String(Math.round(Math.abs(amount) * 10 ** decimals)),
      decimals,
    };
    if (amount < 0) outs.push(ta);
    else if (amount > 0) ins.push(ta);
  }

  if (outs.length === 0 && ins.length === 0) return [];
  
  // Debug logging for swap detection
  console.log(`TX ${sig.slice(0,8)}... | SOL: ${solChange.toFixed(4)} | Tokens: ${Array.from(mintDeltas.entries()).map(([m, d]) => `${m.slice(0,6)}:${d.amount.toFixed(2)}`).join(', ')} | Outs: ${outs.length} Ins: ${ins.length}`);
  
  const date = blockTime
    ? new Date(blockTime * 1000).toISOString().slice(0, 19).replace("T", " ")
    : "";
  const solscanUrl = `${SOLSCAN_TX}${sig}`;
  
  // Collect all addresses involved in the transaction (excluding the wallet itself)
  const involvedAddresses = accountKeys
    .map((k) => getPubkey(k))
    .filter((addr) => addr !== wallet);

  // If we have both ins and outs, it's a swap
  if (outs.length > 0 && ins.length > 0) {
    // Return all swap pairs (in case of multi-hop swaps)
    const trades: Trade[] = [];
    const maxLen = Math.max(outs.length, ins.length);
    for (let i = 0; i < maxLen; i++) {
      trades.push({
        signature: sig,
        blockTime: blockTime ?? 0,
        date,
        type: "swap",
        from: outs[i] ?? outs[0],
        to: ins[i] ?? ins[0],
        solscanUrl,
        involvedAddresses,
      });
    }
    return trades;
  }
  
  if (outs.length > 0 && ins.length === 0) {
    return outs.map((from) => ({
      signature: sig,
      blockTime: blockTime ?? 0,
      date,
      type: "transfer_out" as const,
      from,
      to: { mint: "-", amount: 0, amountRaw: "0", decimals: 0 },
      solscanUrl,
      involvedAddresses,
    }));
  }
  
  if (ins.length > 0 && outs.length === 0) {
    return ins.map((to) => ({
      signature: sig,
      blockTime: blockTime ?? 0,
      date,
      type: "transfer_in" as const,
      from: { mint: "-", amount: 0, amountRaw: "0", decimals: 0 },
      to,
      solscanUrl,
      involvedAddresses,
    }));
  }
  
  return [];
}

// Helper to check if a trade meets minimum value threshold
function meetsMinValue(trade: Trade): boolean {
  // If SOL is involved, check SOL amount
  if (trade.from.mint === WSOL_MINT && trade.from.amount >= MIN_TRADE_VALUE_SOL) {
    return true;
  }
  if (trade.to.mint === WSOL_MINT && trade.to.amount >= MIN_TRADE_VALUE_SOL) {
    return true;
  }
  // For token-only transactions without SOL, include them (we can't easily determine value)
  if (trade.from.mint !== WSOL_MINT && trade.to.mint !== WSOL_MINT && trade.from.mint !== "-" && trade.to.mint !== "-") {
    return true;
  }
  return false;
}

// Post-process trades to combine deposits and withdrawals that happen close together into swaps
// This handles DEXs that split swaps into multiple transactions
const TIME_WINDOW_SECONDS = 10; // Transactions within 10 seconds might be related

function combineRelatedTrades(trades: Trade[]): Trade[] {
  // Sort by time
  const sorted = [...trades].sort((a, b) => a.blockTime - b.blockTime);
  const result: Trade[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    
    const trade = sorted[i];
    
    // If it's already a swap, keep it as is
    if (trade.type === "swap") {
      result.push(trade);
      used.add(i);
      continue;
    }

    // Try to find a matching transaction within the time window
    // Withdraw + Deposit nearby = potential swap
    if (trade.type === "transfer_out") {
      // Look for a deposit within the time window
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(j)) continue;
        
        const other = sorted[j];
        const timeDiff = Math.abs(other.blockTime - trade.blockTime);
        
        if (timeDiff > TIME_WINDOW_SECONDS) break; // Outside window
        
        if (other.type === "transfer_in") {
          // Found a potential match - combine into swap
          result.push({
            signature: trade.signature, // Use the first transaction's signature
            blockTime: trade.blockTime,
            date: trade.date,
            type: "swap",
            from: trade.from,
            to: other.to,
            solscanUrl: trade.solscanUrl,
          });
          used.add(i);
          used.add(j);
          break;
        }
      }
      
      // If no match found, keep as transfer_out
      if (!used.has(i)) {
        result.push(trade);
        used.add(i);
      }
    } else if (trade.type === "transfer_in") {
      // Look for a withdrawal within the time window (check backwards too)
      let matched = false;
      
      // Check backwards first (in case withdraw came before deposit)
      for (let j = i - 1; j >= 0; j--) {
        if (used.has(j)) continue;
        
        const other = sorted[j];
        const timeDiff = Math.abs(other.blockTime - trade.blockTime);
        
        if (timeDiff > TIME_WINDOW_SECONDS) break;
        
        if (other.type === "transfer_out") {
          // Found a potential match - combine into swap
          result.push({
            signature: other.signature,
            blockTime: other.blockTime,
            date: other.date,
            type: "swap",
            from: other.from,
            to: trade.to,
            solscanUrl: other.solscanUrl,
          });
          used.add(i);
          used.add(j);
          matched = true;
          break;
        }
      }
      
      // If no match found, keep as transfer_in
      if (!matched && !used.has(i)) {
        result.push(trade);
        used.add(i);
      }
    } else {
      result.push(trade);
      used.add(i);
    }
  }

  return result.sort((a, b) => b.blockTime - a.blockTime);
}

// Result of processing trades
interface ProcessedTrades {
  unifiedTrades: UnifiedTrade[];
  solTransactions: SolTransaction[];
  totalDeposited: number;
  totalWithdrawn: number;
  totalCashback: number;
}

// Calculate unified trades by grouping buys and sells for each token
// Also extract SOL deposits/withdrawals and calculate running balances
function processTrades(trades: Trade[]): ProcessedTrades {
  // Sort all trades by time (oldest first) for running balance calculation
  const sortedTrades = [...trades].sort((a, b) => a.blockTime - b.blockTime);
  
  // Group trades by token (non-SOL token in the swap)
  const tokenTrades = new Map<string, TokenTransaction[]>();
  const solTxs: SolTransaction[] = [];
  
  // Track all SOL movements for running balance
  interface SolMovement {
    blockTime: number;
    date: string;
    signature: string;
    solscanUrl: string;
    change: number; // positive = received, negative = spent
    type: "swap_buy" | "swap_sell" | "deposit" | "withdrawal" | "cashback";
    tokenMint?: string;
    tokenAmount?: number;
  }
  
  const allSolMovements: SolMovement[] = [];
  
  for (const trade of sortedTrades) {
    if (trade.type === "swap") {
      // Determine if this is a buy (SOL out, token in) or sell (token out, SOL in)
      const isBuy = trade.from.mint === WSOL_MINT && trade.to.mint !== WSOL_MINT;
      const isSell = trade.to.mint === WSOL_MINT && trade.from.mint !== WSOL_MINT;
      
      if (!isBuy && !isSell) continue; // Skip token-to-token swaps
      
      const tokenMint = isBuy ? trade.to.mint : trade.from.mint;
      const solAmount = isBuy ? trade.from.amount : trade.to.amount;
      const tokenAmount = isBuy ? trade.to.amount : trade.from.amount;
      
      const tx: TokenTransaction = {
        signature: trade.signature,
        date: trade.date,
        blockTime: trade.blockTime,
        type: isBuy ? "buy" : "sell",
        solAmount,
        tokenAmount,
        solscanUrl: trade.solscanUrl,
      };
      
      if (!tokenTrades.has(tokenMint)) {
        tokenTrades.set(tokenMint, []);
      }
      tokenTrades.get(tokenMint)!.push(tx);
      
      // Track SOL movement
      allSolMovements.push({
        blockTime: trade.blockTime,
        date: trade.date,
        signature: trade.signature,
        solscanUrl: trade.solscanUrl,
        change: isBuy ? -solAmount : solAmount,
        type: isBuy ? "swap_buy" : "swap_sell",
        tokenMint,
        tokenAmount,
      });
    } else if (trade.type === "transfer_in" && trade.to.mint === WSOL_MINT) {
      // SOL deposit - check for known addresses (cashback, etc.)
      let label: string | undefined;
      let sourceAddress: string | undefined;
      let isCashback = false;
      
      if (trade.involvedAddresses) {
        for (const addr of trade.involvedAddresses) {
          if (KNOWN_ADDRESSES[addr]) {
            const knownLabel = KNOWN_ADDRESSES[addr];
            if (knownLabel === "CASHBACK") {
              isCashback = true;
            } else {
              label = knownLabel;
            }
            sourceAddress = addr;
            break;
          }
        }
      }
      
      solTxs.push({
        signature: trade.signature,
        date: trade.date,
        blockTime: trade.blockTime,
        type: isCashback ? "cashback" : "deposit",
        amount: trade.to.amount,
        solscanUrl: trade.solscanUrl,
        label: isCashback ? undefined : label,
        sourceAddress,
      });
      
      allSolMovements.push({
        blockTime: trade.blockTime,
        date: trade.date,
        signature: trade.signature,
        solscanUrl: trade.solscanUrl,
        change: trade.to.amount,
        type: isCashback ? "cashback" : "deposit",
      });
    } else if (trade.type === "transfer_out" && trade.from.mint === WSOL_MINT) {
      // SOL withdrawal - check for known addresses
      let label: string | undefined;
      let sourceAddress: string | undefined;
      
      if (trade.involvedAddresses) {
        for (const addr of trade.involvedAddresses) {
          if (KNOWN_ADDRESSES[addr]) {
            label = KNOWN_ADDRESSES[addr];
            sourceAddress = addr;
            break;
          }
        }
      }
      
      solTxs.push({
        signature: trade.signature,
        date: trade.date,
        blockTime: trade.blockTime,
        type: "withdrawal",
        amount: trade.from.amount,
        solscanUrl: trade.solscanUrl,
        label,
        sourceAddress,
      });
      
      allSolMovements.push({
        blockTime: trade.blockTime,
        date: trade.date,
        signature: trade.signature,
        solscanUrl: trade.solscanUrl,
        change: -trade.from.amount,
        type: "withdrawal",
      });
    }
  }
  
  // Calculate running SOL balance (starting from 0, showing relative changes)
  // Sort by time
  allSolMovements.sort((a, b) => a.blockTime - b.blockTime);
  
  let runningBalance = 0;
  const balanceBySignature = new Map<string, number>();
  
  for (const movement of allSolMovements) {
    runningBalance += movement.change;
    balanceBySignature.set(movement.signature, runningBalance);
  }
  
  // Add running balance to SOL transactions
  for (const tx of solTxs) {
    tx.solBalanceAfter = balanceBySignature.get(tx.signature);
  }
  
  // Add running balance to token transactions
  for (const [, transactions] of tokenTrades) {
    for (const tx of transactions) {
      tx.solBalanceAfter = balanceBySignature.get(tx.signature);
    }
  }
  
  // Calculate PNL for each token
  const unifiedTrades: UnifiedTrade[] = [];
  
  for (const [tokenMint, transactions] of tokenTrades) {
    // Sort by time (oldest first)
    transactions.sort((a, b) => a.blockTime - b.blockTime);
    
    let totalSolSpent = 0;
    let totalSolReceived = 0;
    let totalTokensBought = 0;
    let totalTokensSold = 0;
    
    for (const tx of transactions) {
      if (tx.type === "buy") {
        totalSolSpent += tx.solAmount;
        totalTokensBought += tx.tokenAmount;
      } else {
        totalSolReceived += tx.solAmount;
        totalTokensSold += tx.tokenAmount;
      }
    }
    
    const tokensRemaining = totalTokensBought - totalTokensSold;
    const pnl = totalSolReceived - totalSolSpent;
    const pnlPercent = totalSolSpent > 0 ? (pnl / totalSolSpent) * 100 : 0;
    const realized = tokensRemaining <= 0;
    
    unifiedTrades.push({
      tokenMint,
      totalSolSpent,
      totalSolReceived,
      totalTokensBought,
      totalTokensSold,
      tokensRemaining: Math.max(0, tokensRemaining),
      pnl,
      pnlPercent,
      realized,
      transactions,
      firstBuyDate: transactions.find(t => t.type === "buy")?.date ?? transactions[0].date,
      lastActivityDate: transactions[transactions.length - 1].date,
    });
  }
  
  // Sort unified trades by last activity date (most recent first)
  unifiedTrades.sort((a, b) => b.lastActivityDate.localeCompare(a.lastActivityDate));
  
  // Sort SOL transactions by time (most recent first)
  solTxs.sort((a, b) => b.blockTime - a.blockTime);
  
  // Calculate totals (cashback is separate from deposits)
  const totalDeposited = solTxs.filter(t => t.type === "deposit").reduce((sum, t) => sum + t.amount, 0);
  const totalWithdrawn = solTxs.filter(t => t.type === "withdrawal").reduce((sum, t) => sum + t.amount, 0);
  const totalCashback = solTxs.filter(t => t.type === "cashback").reduce((sum, t) => sum + t.amount, 0);
  
  return {
    unifiedTrades,
    solTransactions: solTxs,
    totalDeposited,
    totalWithdrawn,
    totalCashback,
  };
}

export async function POST(request: Request) {
  try {
    const { address, startDate, endDate } = (await request.json()) as { 
      address?: string;
      startDate?: string; // ISO date string (e.g., "2024-01-01")
      endDate?: string;   // ISO date string (e.g., "2024-01-31")
    };
    if (!address || typeof address !== "string") {
      return Response.json(
        { error: "Missing or invalid address" },
        { status: 400 }
      );
    }
    const wallet = address.trim();
    
    // Parse date filters
    const startTimestamp = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : null;
    const endTimestamp = endDate ? Math.floor(new Date(endDate + "T23:59:59").getTime() / 1000) : null;
    
    console.log(`Date filter: ${startDate || 'none'} to ${endDate || 'none'}`);
    try {
      new PublicKey(wallet);
    } catch {
      return Response.json(
        { error: "Invalid Solana address" },
        { status: 400 }
      );
    }

    const connection = new Connection(RPC, "confirmed");
    const pubkey = new PublicKey(wallet);

    // Fetch signatures; when a date range is set, stop once we're past the period (signatures are newest-first)
    type SigWithTime = { signature: string; blockTime: number | null };
    const allSignatures: SigWithTime[] = [];
    let lastSignature: string | undefined;

    console.log(startTimestamp != null || endTimestamp != null ? "Fetching signatures (will stop when past date range)..." : "Fetching all transaction signatures...");
    while (true) {
      const batch = await withRetry(() =>
        connection.getSignaturesForAddress(pubkey, {
          limit: SIGNATURES_PER_REQUEST,
          before: lastSignature,
        })
      );

      if (batch.length === 0) break;

      const withTime: SigWithTime[] = batch.map((s) => ({ signature: s.signature, blockTime: s.blockTime ?? null }));
      allSignatures.push(...withTime);
      lastSignature = batch[batch.length - 1].signature;

      console.log(`Fetched ${allSignatures.length} signatures so far...`);

      // When we have a start date, stop once the oldest in this batch is before the period (signatures are newest-first)
      if (startTimestamp != null && withTime.length > 0) {
        const oldestInBatch = withTime[withTime.length - 1];
        if (oldestInBatch.blockTime != null && oldestInBatch.blockTime < startTimestamp) {
          console.log(`Reached before period (blockTime ${oldestInBatch.blockTime} < ${startTimestamp}). Stopping fetch.`);
          break;
        }
      }

      if (batch.length < SIGNATURES_PER_REQUEST) break;
      await delay(100);
    }

    // Filter signatures by date so we only parse transactions in range
    let signaturesToParse = allSignatures;
    if (startTimestamp != null || endTimestamp != null) {
      signaturesToParse = allSignatures.filter((s) => {
        const t = s.blockTime;
        if (t == null) return true; // include if unknown
        if (startTimestamp != null && t < startTimestamp) return false;
        if (endTimestamp != null && t > endTimestamp) return false;
        return true;
      });
      console.log(`Date filter: ${allSignatures.length} signatures -> ${signaturesToParse.length} in range. Parsing ${signaturesToParse.length} transactions...`);
    } else {
      console.log(`Total signatures: ${allSignatures.length}. Processing transactions...`);
    }

    const trades: Trade[] = [];
    let processed = 0;

    for (let i = 0; i < signaturesToParse.length; i += CONCURRENCY) {
      const batch = signaturesToParse.slice(i, i + CONCURRENCY);

      const parsed = await withRetry(() =>
        Promise.all(
          batch.map((s) =>
            connection.getParsedTransaction(s.signature, {
              maxSupportedTransactionVersion: 0,
            })
          )
        )
      );

      for (let j = 0; j < batch.length; j++) {
        const txTrades = extractTradesFromTx(
          batch[j].signature,
          wallet,
          parsed[j] as ParsedTx | null
        );
        const filtered = txTrades.filter(meetsMinValue);
        trades.push(...filtered);
      }

      processed += batch.length;
      if (processed % 50 === 0) {
        console.log(`Processed ${processed}/${signaturesToParse.length} transactions, found ${trades.length} trades...`);
      }

      await delay(BATCH_DELAY_MS);
    }

    // Combine related trades (deposits + withdrawals that happen close together = swaps)
    console.log(`Found ${trades.length} individual trades. Combining related transactions...`);
    const combinedTrades = combineRelatedTrades(trades);

    // Process trades: calculate unified trades with PNL and extract SOL transactions
    const { unifiedTrades, solTransactions, totalDeposited, totalWithdrawn, totalCashback } = processTrades(combinedTrades);
    const totalPnl = unifiedTrades.reduce((sum, t) => sum + t.pnl, 0);
    
    console.log(`Done! ${combinedTrades.length} trades, ${unifiedTrades.length} tokens traded, ${solTransactions.length} SOL transfers`);
    console.log(`Total PNL: ${totalPnl.toFixed(4)} SOL | Deposited: ${totalDeposited.toFixed(4)} SOL | Withdrawn: ${totalWithdrawn.toFixed(4)} SOL | Cashback: ${totalCashback.toFixed(4)} SOL`);

    return Response.json({
      address: wallet,
      trades: combinedTrades,
      unifiedTrades,
      solTransactions,
      totalCount: combinedTrades.length,
      totalTransactions: signaturesToParse.length,
      totalPnl,
      totalDeposited,
      totalWithdrawn,
      totalCashback,
      solscanProfileUrl: `${SOLSCAN_ACCOUNT}${wallet}`,
    });
  } catch (e) {
    console.error(e);
    return Response.json(
      {
        error: e instanceof Error ? e.message : "Failed to analyze wallet",
      },
      { status: 500 }
    );
  }
}
