"use client";

import { useState, useEffect, Fragment } from "react";
import type { AnalysisResult } from "@/types/analyze";
import { Charts } from "@/components/Charts";

// Custom labels storage key
const LABELS_STORAGE_KEY = "solana-tax-analyzer-labels";

// Binance API for SOL price
const BINANCE_SOL_PRICE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";

// Token list and on-chain metadata (same source as Solscan Profile summary)
const TOKEN_LIST_API = "/api/token-list";
const TOKEN_META_API = "/api/token-meta";

function shortMint(mint: string): string {
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function getTokenSymbol(mint: string, mintToSymbol: Record<string, string> | null): string {
  if (mintToSymbol && mintToSymbol[mint]) return mintToSymbol[mint];
  return shortMint(mint);
}

function formatSol(amount: number): string {
  if (Math.abs(amount) >= 1000) return amount.toFixed(2);
  if (Math.abs(amount) >= 1) return amount.toFixed(4);
  return amount.toFixed(6);
}

function formatTokens(amount: number): string {
  if (amount >= 1e9) return (amount / 1e9).toFixed(2) + "B";
  if (amount >= 1e6) return (amount / 1e6).toFixed(2) + "M";
  if (amount >= 1e3) return (amount / 1e3).toFixed(2) + "K";
  if (amount >= 1) return amount.toFixed(2);
  return amount.toFixed(6);
}

function formatPercent(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(1)}%`;
}

function shortSig(sig: string): string {
  return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
}

function formatUsd(amount: number): string {
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(2)}K`;
  if (Math.abs(amount) >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

// Quick presets for date ranges
const DATE_PRESETS = [
  { label: "All Time", value: "all" },
  { label: "This Month", value: "this-month" },
  { label: "Last Month", value: "last-month" },
  { label: "This Year", value: "this-year" },
  { label: "2025", value: "2025" },
  { label: "2024", value: "2024" },
  { label: "Custom", value: "custom" },
];

function getDatePreset(preset: string): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  switch (preset) {
    case "this-month": {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    }
    case "last-month": {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    }
    case "this-year": {
      return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
      };
    }
    case "2025": {
      return { start: "2025-01-01", end: "2025-12-31" };
    }
    case "2024": {
      return { start: "2024-01-01", end: "2024-12-31" };
    }
    default:
      return { start: "", end: "" };
  }
}

export default function Home() {
  const [address, setAddress] = useState("");
  /** Multiple wallets to batch-analyze (shown as chips). */
  const [walletList, setWalletList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  /** One result per wallet (same order as walletList when batch). Single wallet: results.length === 1. */
  const [results, setResults] = useState<AnalysisResult[]>([]);
  /** Which wallet's data to show in main UI when results.length > 1. */
  const [selectedWalletIndex, setSelectedWalletIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expandedToken, setExpandedToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"trades" | "transfers">("trades");
  const [datePreset, setDatePreset] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showPrintView, setShowPrintView] = useState(false);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [mintToSymbol, setMintToSymbol] = useState<Record<string, string>>({});
  const [costBasisMethod, setCostBasisMethod] = useState<"FIFO" | "LIFO" | "HIFO">("FIFO");
  const [taxJurisdiction, setTaxJurisdiction] = useState<"US" | "EU" | "OTHER">("US");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showFaq, setShowFaq] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  /** During batch: "2/5" etc. */
  const [analyzingStep, setAnalyzingStep] = useState("");
  const [filterTokenMint, setFilterTokenMint] = useState("");
  const [filterMinSol, setFilterMinSol] = useState("");

  // Custom labels state
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");

  // Load custom labels from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(LABELS_STORAGE_KEY);
    if (stored) {
      try {
        setCustomLabels(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse stored labels:", e);
      }
    }
  }, []);

  // Fetch token list (Solana Labs) for mint → symbol
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(TOKEN_LIST_API);
        const data = await res.json();
        if (cancelled || !data?.mintToSymbol) return;
        if (!cancelled) setMintToSymbol(data.mintToSymbol);
      } catch (e) {
        console.error("Failed to fetch token list:", e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // After analysis: fetch on-chain Metaplex metadata (same as Solscan) for mints not in token list
  useEffect(() => {
    if (!results.length) return;
    const mints = [...new Set(results.flatMap((r) => r.unifiedTrades?.map((t) => t.tokenMint) ?? []))];
    let cancelled = false;
    (async () => {
      const batch = mints.slice(0, 50);
      try {
        const res = await fetch(
          `${TOKEN_META_API}?mints=${encodeURIComponent(batch.join(","))}`
        );
        const data = await res.json();
        if (cancelled || !data?.mintToSymbol) return;
        setMintToSymbol((prev) => ({ ...prev, ...data.mintToSymbol }));
      } catch (e) {
        console.error("Failed to fetch token meta:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [results]);

  // Fetch SOL price from Binance
  useEffect(() => {
    async function fetchSolPrice() {
      try {
        const res = await fetch(BINANCE_SOL_PRICE_URL);
        const data = await res.json();
        if (data.price) {
          setSolPrice(parseFloat(data.price));
        }
      } catch (e) {
        console.error("Failed to fetch SOL price:", e);
      }
    }
    
    fetchSolPrice();
    // Refresh price every 30 seconds
    const interval = setInterval(fetchSolPrice, 30000);
    return () => clearInterval(interval);
  }, []);

  // Save custom labels to localStorage
  function saveLabel(signature: string, label: string) {
    const newLabels = { ...customLabels };
    if (label.trim()) {
      newLabels[signature] = label.trim().toUpperCase();
    } else {
      delete newLabels[signature];
    }
    setCustomLabels(newLabels);
    localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(newLabels));
    setEditingLabel(null);
    setLabelInput("");
  }

  function startEditingLabel(signature: string, currentLabel?: string) {
    setEditingLabel(signature);
    setLabelInput(currentLabel || customLabels[signature] || "");
  }

  function cancelEditingLabel() {
    setEditingLabel(null);
    setLabelInput("");
  }

  function handlePrint() {
    setShowPrintView(true);
    setTimeout(() => {
      window.print();
    }, 100);
  }

  function escapeCsv(s: string): string {
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function handleExportCsv() {
    if (!result) return;
    const rows: string[] = [];
    rows.push("Section,Label,SOL,USD (if rate set)");
    if (solPrice) {
      rows.push(`Summary,Total Deposits,+${formatSol(totalDeposited)},${formatUsd(totalDeposited * solPrice)}`);
      rows.push(`Summary,Total Withdrawals,-${formatSol(totalWithdrawn)},${formatUsd(totalWithdrawn * solPrice)}`);
      if (totalCashback > 0) rows.push(`Summary,Cashback/Rewards,+${formatSol(totalCashback)},${formatUsd(totalCashback * solPrice)}`);
      rows.push(`Summary,Trading PNL,${totalPnl >= 0 ? "+" : ""}${formatSol(totalPnl)},${formatUsd(totalPnl * solPrice)}`);
      rows.push(`Summary,Net Flow,${netFlow >= 0 ? "+" : ""}${formatSol(netFlow)},${formatUsd(netFlow * solPrice)}`);
    } else {
      rows.push(`Summary,Total Deposits,+${formatSol(totalDeposited)},`);
      rows.push(`Summary,Total Withdrawals,-${formatSol(totalWithdrawn)},`);
      if (totalCashback > 0) rows.push(`Summary,Cashback/Rewards,+${formatSol(totalCashback)},`);
      rows.push(`Summary,Trading PNL,${totalPnl >= 0 ? "+" : ""}${formatSol(totalPnl)},`);
      rows.push(`Summary,Net Flow,${netFlow >= 0 ? "+" : ""}${formatSol(netFlow)},`);
    }
    rows.push("");
    rows.push("Token,Cost Basis (SOL),Proceeds (SOL),Gain/Loss (SOL),Status");
    for (const t of unifiedTrades) {
      rows.push([
        getTokenSymbol(t.tokenMint, mintToSymbol),
        formatSol(t.totalSolSpent),
        formatSol(t.totalSolReceived),
        (t.pnl >= 0 ? "+" : "") + formatSol(t.pnl),
        t.realized ? "Closed" : `Holding ${formatTokens(t.tokensRemaining)}`,
      ].map(escapeCsv).join(","));
    }
    rows.push("");
    rows.push("Date,Type,Description,Amount (SOL),Transaction ID");
    for (const tx of solTransactions) {
      const label = customLabels[tx.signature] || tx.label || "";
      rows.push([
        tx.date,
        tx.type === "deposit" ? "Deposit" : tx.type === "cashback" ? "Cashback" : "Withdrawal",
        label,
        (tx.type === "withdrawal" ? "-" : "+") + formatSol(tx.amount),
        tx.signature,
      ].map(escapeCsv).join(","));
    }
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `solana-tax-${result.address.slice(0, 8)}-${startDate || "all"}-${endDate || "now"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportJson() {
    if (!result) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      address: result.address,
      period: { start: startDate || null, end: endDate || null },
      summary: {
        totalDeposited,
        totalWithdrawn,
        totalCashback,
        totalPnl,
        netFlow,
        totalTransactions: result.totalTransactions,
      },
      solPrice: solPrice ?? null,
      costBasisMethod: result.costBasisMethod ?? costBasisMethod,
      taxJurisdiction,
      unifiedTrades: result.unifiedTrades,
      solTransactions: result.solTransactions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `solana-tax-${result.address.slice(0, 8)}-${startDate || "all"}-${endDate || "now"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePresetChange(preset: string) {
    setDatePreset(preset);
    if (preset === "all") {
      setStartDate("");
      setEndDate("");
    } else if (preset !== "custom") {
      const { start, end } = getDatePreset(preset);
      setStartDate(start);
      setEndDate(end);
    }
  }

  function getAddressesToAnalyze(): string[] {
    const list = walletList.filter((a) => a.trim());
    if (list.length > 0) return list;
    if (address.trim()) return [address.trim()];
    return [];
  }

  async function handleAnalyze() {
    const addresses = getAddressesToAnalyze();
    if (addresses.length === 0) {
      setError("Enter a wallet address or add one or more to the list.");
      return;
    }
    setError(null);
    setResults([]);
    setSelectedWalletIndex(0);
    setLoading(true);
    setLoadingProgress(0);
    setAnalyzingStep("");
    const total = addresses.length;
    const collected: AnalysisResult[] = [];
    try {
      for (let i = 0; i < addresses.length; i++) {
        setAnalyzingStep(total > 1 ? `${i + 1}/${total}` : "");
        setLoadingProgress(total > 1 ? Math.round(((i + 0.5) / total) * 90) : 50);
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: addresses[i],
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            costBasisMethod: costBasisMethod || "FIFO",
          }),
        });
        const text = await res.text();
        let data: { error?: string; [key: string]: unknown } | null = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          setError(`Wallet ${i + 1}/${total}: Server returned an invalid response. Try a smaller date range.`);
          setResults([...collected]);
          return;
        }
        if (!res.ok) {
          const msg = (data?.error as string) || "Analysis failed";
          setError(`Wallet ${addresses[i].slice(0, 8)}…: ${msg}`);
          setResults([...collected]);
          return;
        }
        collected.push(data as AnalysisResult);
      }
      setLoadingProgress(100);
      setResults(collected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error. Check your connection and try again.");
      setResults([...collected]);
    } finally {
      setLoading(false);
      setTimeout(() => setLoadingProgress(0), 300);
    }
  }

  /** Current result shown in main UI (selected wallet when batch). */
  const result = results.length > 0 ? results[selectedWalletIndex] ?? results[0] : null;

  const rawUnifiedTrades = result?.unifiedTrades ?? [];
  const rawSolTransactions = result?.solTransactions ?? [];
  const minSol = filterMinSol ? parseFloat(filterMinSol) : 0;
  const unifiedTrades = rawUnifiedTrades.filter((t) => {
    if (filterTokenMint && t.tokenMint !== filterTokenMint) return false;
    const vol = t.totalSolSpent + t.totalSolReceived;
    return !Number.isNaN(minSol) && vol >= minSol;
  });
  const solTransactions = rawSolTransactions.filter((tx) => {
    if (Number.isNaN(minSol)) return true;
    return tx.amount >= minSol;
  });
  const totalPnl = result?.totalPnl ?? 0;
  const totalDeposited = result?.totalDeposited ?? 0;
  const totalWithdrawn = result?.totalWithdrawn ?? 0;
  const totalCashback = result?.totalCashback ?? 0;
  // Net Flow = total SOL change over period: deposits + cashback − withdrawals + trading PNL
  const netFlow = totalDeposited + totalCashback - totalWithdrawn + totalPnl;

  const isDark = theme === "dark";
  const muted = isDark ? "text-zinc-500" : "text-zinc-600";

  return (
    <div className={`min-h-screen ${isDark ? "bg-zinc-950 text-zinc-100" : "bg-zinc-100 text-zinc-900"} transition-colors`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Header */}
        <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white tracking-tight">
              Solana Tax Analyzer
            </h1>
            <p className={`${muted} mt-1 text-sm`}>
              Trading history and PNL analysis
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="px-3 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white text-xs"
              title={isDark ? "Light mode" : "Dark mode"}
            >
              {isDark ? "☀️ Light" : "🌙 Dark"}
            </button>
            <button
              onClick={() => setShowFaq(true)}
              className="px-3 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white text-xs"
            >
              FAQ / Help
            </button>
            <a
              href="https://github.com/meadowclarence38/solana-tax-analyzer"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white text-xs"
            >
              GitHub
            </a>
          </div>
        </header>

        {/* Search Section */}
        <div className="space-y-4 mb-10">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Enter wallet address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              className="flex-1 min-w-[200px] px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => {
                const a = address.trim();
                if (!a) return;
                if (walletList.includes(a)) return;
                setWalletList((prev) => [...prev, a]);
                setAddress("");
                setError(null);
              }}
              className="px-4 py-3 rounded-lg border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 transition-colors"
            >
              Add wallet
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Cost basis:</span>
              <select
                value={costBasisMethod}
                onChange={(e) => setCostBasisMethod(e.target.value as "FIFO" | "LIFO" | "HIFO")}
                className="px-2 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs"
              >
                <option value="FIFO">FIFO</option>
                <option value="LIFO">LIFO</option>
                <option value="HIFO">HIFO</option>
              </select>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="px-6 py-3 rounded-lg bg-white text-zinc-900 font-medium text-sm hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? `Analyzing… ${loadingProgress}%` : walletList.length > 0 ? `Analyze ${walletList.length + (address.trim() ? 1 : 0)} wallets` : "Analyze"}
            </button>
          </div>
          {walletList.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">Wallets to analyze:</span>
              {walletList.map((w, i) => (
                <span
                  key={w}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 font-mono text-xs text-zinc-300"
                >
                  {w.slice(0, 6)}…{w.slice(-4)}
                  <button
                    type="button"
                    onClick={() => setWalletList((prev) => prev.filter((_, j) => j !== i))}
                    className="text-zinc-500 hover:text-white"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setWalletList([])}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Clear all
              </button>
            </div>
          )}
          <p className="text-[10px] text-zinc-500">Re-run analysis after changing cost basis to update PnL. Add multiple wallets to batch-analyze; PDF export includes each wallet in a separate section.</p>

          {/* Reporting period – prominent; choosing a range speeds up analysis */}
          <div className="p-4 rounded-lg bg-zinc-900/80 border border-zinc-800">
            <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Reporting period</div>
            <div className="flex flex-wrap items-center gap-2">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handlePresetChange(preset.value)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    datePreset === preset.value
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              {datePreset === "custom" && (
                <div className="flex items-center gap-2 ml-1">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-white text-sm"
                  />
                  <span className="text-zinc-600">—</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-white text-sm"
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Choosing a date range speeds up analysis by fetching only that period.
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-8 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Loading with progress */}
        {loading && (
          <div className="mb-8 p-4 rounded-lg bg-zinc-900 border border-zinc-800">
            <p className="text-zinc-400 text-sm mb-2">
              {analyzingStep ? (
                <>Analyzing wallet {analyzingStep}…</>
              ) : startDate || endDate ? (
                <>Analyzing period {startDate || "beginning"} – {endDate || "now"}…</>
              ) : (
                <>Fetching transactions… This may take a few minutes for large wallets.</>
              )}
            </p>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-white/80 transition-all duration-300"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="text-zinc-500 text-xs mt-2">Tip: choose a date range above to speed up analysis.</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {results.length > 1 && (
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">Wallet:</span>
                <select
                  value={selectedWalletIndex}
                  onChange={(e) => setSelectedWalletIndex(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-mono"
                >
                  {results.map((r, i) => (
                    <option key={r.address} value={i}>
                      {r.address.slice(0, 6)}…{r.address.slice(-4)} — PNL {formatSol(r.totalPnl)}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-zinc-500">PDF export includes all {results.length} wallets in one file.</span>
              </div>
            )}
            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
                <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Trading PNL</div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-semibold font-mono ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {totalPnl >= 0 ? '+' : ''}{formatSol(totalPnl)}
                  </span>
                  {solPrice && (
                    <span className={`text-xs font-mono ${totalPnl >= 0 ? 'text-green-500/50' : 'text-red-500/50'}`}>
                      {totalPnl >= 0 ? '+' : ''}{formatUsd(totalPnl * solPrice)}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
                <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Deposited</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold font-mono text-zinc-100">
                    +{formatSol(totalDeposited)}
                  </span>
                  {solPrice && (
                    <span className="text-xs font-mono text-zinc-500">
                      {formatUsd(totalDeposited * solPrice)}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
                <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Withdrawn</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold font-mono text-zinc-100">
                    -{formatSol(totalWithdrawn)}
                  </span>
                  {solPrice && (
                    <span className="text-xs font-mono text-zinc-500">
                      {formatUsd(totalWithdrawn * solPrice)}
                    </span>
                  )}
                </div>
              </div>
              {totalCashback > 0 && (
                <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
                  <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Cashback</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-semibold font-mono text-blue-400">
                      +{formatSol(totalCashback)}
                    </span>
                    {solPrice && (
                      <span className="text-xs font-mono text-blue-400/50">
                        {formatUsd(totalCashback * solPrice)}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800" title="Deposits + Cashback − Withdrawals + Trading PNL (total SOL change over period)">
                <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Net Flow</div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-semibold font-mono ${netFlow >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {netFlow >= 0 ? '+' : ''}{formatSol(netFlow)}
                  </span>
                  {solPrice && (
                    <span className={`text-xs font-mono ${netFlow >= 0 ? 'text-green-500/50' : 'text-red-500/50'}`}>
                      {netFlow >= 0 ? '+' : ''}{formatUsd(netFlow * solPrice)}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">Deposits + Cashback − Withdrawals + PNL</p>
              </div>
            </div>

            {/* Charts */}
            <Charts
              unifiedTrades={unifiedTrades}
              getTokenSymbol={(mint) => getTokenSymbol(mint, mintToSymbol)}
              isDark={theme === "dark"}
            />

            {/* Tax & export options */}
            <div className="flex flex-wrap items-center gap-4 mb-6 p-4 rounded-lg bg-zinc-900/60 border border-zinc-800">
              {result?.costBasisMethod && (
                <span className="text-xs text-zinc-500">PnL computed with <strong className="text-zinc-400">{result.costBasisMethod}</strong></span>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Jurisdiction:</span>
                <select
                  value={taxJurisdiction}
                  onChange={(e) => setTaxJurisdiction(e.target.value as "US" | "EU" | "OTHER")}
                  className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs"
                >
                  <option value="US">US</option>
                  <option value="EU">EU</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
              <span className="text-xs text-zinc-500">Filters:</span>
              <select
                value={filterTokenMint}
                onChange={(e) => setFilterTokenMint(e.target.value)}
                className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs"
              >
                <option value="">All tokens</option>
                {rawUnifiedTrades.map((t) => (
                  <option key={t.tokenMint} value={t.tokenMint}>
                    {getTokenSymbol(t.tokenMint, mintToSymbol)}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                Min SOL:
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={filterMinSol}
                  onChange={(e) => setFilterMinSol(e.target.value)}
                  className="w-20 px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs"
                />
              </label>
              {(filterTokenMint || filterMinSol) && (
                <button
                  onClick={() => { setFilterTokenMint(""); setFilterMinSol(""); }}
                  className="text-xs text-zinc-500 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Meta Info */}
            <div className="flex items-center gap-4 mb-6 text-xs text-zinc-500">
              <span>{result.totalTransactions?.toLocaleString()} transactions scanned</span>
              {(startDate || endDate) && (
                <span>• {startDate || "start"} → {endDate || "now"}</span>
              )}
              <a
                href={result.solscanProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-300 transition-colors"
              >
                View on Solscan ↗
              </a>
              {solPrice && (
                <span className="ml-auto text-zinc-600">
                  SOL = ${solPrice.toFixed(2)} USD
                </span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex items-center justify-between mb-6 border-b border-zinc-800">
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveTab("trades")}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === "trades"
                      ? "border-white text-white"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Trades ({unifiedTrades.length})
                </button>
                <button
                  onClick={() => setActiveTab("transfers")}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === "transfers"
                      ? "border-white text-white"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Transfers ({solTransactions.length})
                </button>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  onClick={handleExportCsv}
                  className="px-4 py-1.5 text-xs font-medium text-zinc-400 hover:text-white border border-zinc-700 rounded hover:border-zinc-500 transition-colors"
                >
                  CSV
                </button>
                <button
                  onClick={handleExportJson}
                  className="px-4 py-1.5 text-xs font-medium text-zinc-400 hover:text-white border border-zinc-700 rounded hover:border-zinc-500 transition-colors"
                >
                  JSON
                </button>
                <button
                  onClick={handlePrint}
                  className="px-4 py-1.5 text-xs font-medium text-zinc-400 hover:text-white border border-zinc-700 rounded hover:border-zinc-500 transition-colors"
                >
                  PDF
                </button>
              </div>
            </div>

            {/* Token Trades Tab */}
            {activeTab === "trades" && (
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wide">
                      <th className="py-3 px-4 text-left font-medium">Token</th>
                      <th className="py-3 px-4 text-right font-medium">Spent</th>
                      <th className="py-3 px-4 text-right font-medium">Received</th>
                      <th className="py-3 px-4 text-right font-medium">PNL</th>
                      <th className="py-3 px-4 text-left font-medium">Status</th>
                      <th className="py-3 px-4 text-right font-medium">Txs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {unifiedTrades.map((trade) => (
                      <Fragment key={trade.tokenMint}>
                        <tr
                          className="hover:bg-zinc-900/50 cursor-pointer transition-colors"
                          onClick={() => setExpandedToken(expandedToken === trade.tokenMint ? null : trade.tokenMint)}
                        >
                          <td className="py-3 px-4">
                            <a
                              href={`https://solscan.io/token/${trade.tokenMint}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-zinc-300 hover:text-white transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {getTokenSymbol(trade.tokenMint, mintToSymbol)}
                            </a>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-zinc-400">
                            {formatSol(trade.totalSolSpent)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-zinc-400">
                            {formatSol(trade.totalSolReceived)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono">
                            <span className={trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}>
                              {trade.pnl >= 0 ? '+' : ''}{formatSol(trade.pnl)}
                            </span>
                            <span className="text-zinc-600 text-xs ml-2">
                              {formatPercent(trade.pnlPercent)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {trade.realized ? (
                              <span className="text-zinc-500 text-xs">Closed</span>
                            ) : (
                              <span className="text-zinc-400 text-xs">
                                Holding {formatTokens(trade.tokensRemaining)}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right text-zinc-500">
                            {trade.transactions.length}
                            <span className="ml-2 text-zinc-600">{expandedToken === trade.tokenMint ? '−' : '+'}</span>
                          </td>
                        </tr>
                        {expandedToken === trade.tokenMint && (
                          <tr key={`${trade.tokenMint}-details`}>
                            <td colSpan={6} className="bg-zinc-900/30 px-4 py-3">
                              <div className="space-y-1">
                                {trade.transactions.map((tx, idx) => {
                                  const effectiveLabel = customLabels[tx.signature];
                                  const isEditing = editingLabel === tx.signature;
                                  
                                  return (
                                    <div key={idx} className="flex items-center gap-4 text-xs py-1 group/row flex-wrap">
                                      <span className="text-zinc-600 w-32 font-mono">{tx.date}</span>
                                      <span className={`w-10 ${tx.type === 'buy' ? 'text-zinc-400' : 'text-zinc-400'}`}>
                                        {tx.type === 'buy' ? 'BUY' : 'SELL'}
                                      </span>
                                      <span className={`font-mono w-28 text-right ${tx.type === 'buy' ? 'text-red-500/80' : 'text-green-500/80'}`}>
                                        {tx.type === 'buy' ? '-' : '+'}{formatSol(tx.solAmount)} SOL
                                      </span>
                                      <span className="font-mono text-zinc-500 w-32 text-right">
                                        {formatTokens(tx.tokenAmount)} tokens
                                      </span>
                                      {tx.type === 'sell' && tx.costBasisSol !== undefined && (
                                        <>
                                          <span className="font-mono text-zinc-500 w-24 text-right" title="Cost basis (SOL)">
                                            Cost: {formatSol(tx.costBasisSol)}
                                          </span>
                                          <span className={`font-mono w-24 text-right ${(tx.realizedGainSol ?? 0) >= 0 ? 'text-green-500/80' : 'text-red-500/80'}`} title="Realized gain (SOL)">
                                            {((tx.realizedGainSol ?? 0) >= 0 ? '+' : '')}{formatSol(tx.realizedGainSol ?? 0)}
                                          </span>
                                        </>
                                      )}
                                      <span className="font-mono text-zinc-600 w-24 text-right">
                                        {tx.solBalanceAfter !== undefined ? `${formatSol(tx.solBalanceAfter)}` : '—'}
                                      </span>
                                      {/* Label column */}
                                      <div className="w-24">
                                        {isEditing ? (
                                          <div className="flex items-center gap-1">
                                            <input
                                              type="text"
                                              value={labelInput}
                                              onChange={(e) => setLabelInput(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") saveLabel(tx.signature, labelInput);
                                                if (e.key === "Escape") cancelEditingLabel();
                                              }}
                                              placeholder="Label..."
                                              className="w-16 px-1 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded focus:outline-none"
                                              autoFocus
                                            />
                                            <button onClick={() => saveLabel(tx.signature, labelInput)} className="text-green-500">✓</button>
                                            <button onClick={cancelEditingLabel} className="text-zinc-500">✕</button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1">
                                            {effectiveLabel && <span className="text-zinc-400">{effectiveLabel}</span>}
                                            <button
                                              onClick={() => startEditingLabel(tx.signature, effectiveLabel)}
                                              className="text-zinc-700 hover:text-zinc-400 opacity-0 group-hover/row:opacity-100"
                                              title="Add label"
                                            >
                                              ✎
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                      <a
                                        href={tx.solscanUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-zinc-600 hover:text-zinc-400 font-mono ml-auto"
                                      >
                                        {shortSig(tx.signature)} ↗
                                      </a>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {unifiedTrades.length === 0 && (
                  <div className="py-16 text-center text-zinc-600 text-sm">
                    No trades found
                  </div>
                )}
              </div>
            )}

            {/* SOL Transfers Tab */}
            {activeTab === "transfers" && (
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wide">
                      <th className="py-3 px-4 text-left font-medium">Date</th>
                      <th className="py-3 px-4 text-left font-medium">Type</th>
                      <th className="py-3 px-4 text-left font-medium">Label</th>
                      <th className="py-3 px-4 text-right font-medium">Amount</th>
                      <th className="py-3 px-4 text-right font-medium">Balance</th>
                      <th className="py-3 px-4 text-right font-medium">Transaction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {solTransactions.map((tx, idx) => {
                      const effectiveLabel = customLabels[tx.signature] || tx.label;
                      const isEditing = editingLabel === tx.signature;
                      
                      return (
                        <tr
                          key={`${tx.signature}-${idx}`}
                          className="hover:bg-zinc-900/50 transition-colors group"
                        >
                          <td className="py-3 px-4 font-mono text-zinc-400 text-xs">{tx.date}</td>
                        <td className="py-3 px-4">
                          <span className={
                            tx.type === "cashback" 
                              ? "text-blue-400" 
                              : "text-zinc-300"
                          }>
                            {tx.type === "deposit" ? "Deposit" : tx.type === "cashback" ? "Cashback" : "Withdrawal"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={labelInput}
                                  onChange={(e) => setLabelInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveLabel(tx.signature, labelInput);
                                    if (e.key === "Escape") cancelEditingLabel();
                                  }}
                                  placeholder="Enter label..."
                                  className="w-24 px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded focus:outline-none focus:border-zinc-500"
                                  autoFocus
                                />
                                <button
                                  onClick={() => saveLabel(tx.signature, labelInput)}
                                  className="text-green-500 hover:text-green-400 text-xs"
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={cancelEditingLabel}
                                  className="text-zinc-500 hover:text-zinc-400 text-xs"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                {effectiveLabel ? (
                                  <span className={`text-xs ${tx.label && !customLabels[tx.signature] ? 'text-blue-400' : 'text-zinc-300'}`}>
                                    {effectiveLabel}
                                  </span>
                                ) : (
                                  <span className="text-zinc-600">—</span>
                                )}
                                <button
                                  onClick={() => startEditingLabel(tx.signature, effectiveLabel)}
                                  className="text-zinc-600 hover:text-zinc-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Edit label"
                                >
                                  ✎
                                </button>
                              </div>
                            )}
                          </td>
                        <td className="py-3 px-4 text-right font-mono">
                          <span className={
                            tx.type === "withdrawal" 
                              ? "text-red-500" 
                              : tx.type === "cashback" 
                                ? "text-blue-400" 
                                : "text-green-500"
                          }>
                            {tx.type === "withdrawal" ? "-" : "+"}{formatSol(tx.amount)}
                          </span>
                        </td>
                          <td className="py-3 px-4 text-right font-mono text-zinc-500">
                            {tx.solBalanceAfter !== undefined ? formatSol(tx.solBalanceAfter) : '—'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <a
                              href={tx.solscanUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-600 hover:text-zinc-400 font-mono text-xs"
                            >
                              {shortSig(tx.signature)} ↗
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {solTransactions.length === 0 && (
                  <div className="py-16 text-center text-zinc-600 text-sm">
                    No transfers found
                  </div>
                )}
              </div>
            )}

            {/* Footer Note */}
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-600">
              <p>
                Balance column shows running total relative to first transaction. Click a row to expand details.
              </p>
              {Object.keys(customLabels).length > 0 && (
                <div className="flex items-center gap-3">
                  <span>{Object.keys(customLabels).length} custom label{Object.keys(customLabels).length !== 1 ? 's' : ''}</span>
                  <button
                    onClick={() => {
                      if (confirm("Clear all custom labels?")) {
                        setCustomLabels({});
                        localStorage.removeItem(LABELS_STORAGE_KEY);
                      }
                    }}
                    className="text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty State */}
        {!result && !error && !loading && (
          <div className="text-center py-20">
            <p className="text-zinc-600 text-sm">
              Enter a wallet address to analyze, or add multiple wallets to batch-analyze and export one PDF with each wallet in a separate section.
            </p>
          </div>
        )}
      </div>

      {/* Print View - Tax Report (one section per wallet; page break between) */}
      {showPrintView && results.length > 0 && (
        <div className="fixed inset-0 bg-white text-black z-50 overflow-auto print:relative print:z-auto" id="print-view">
          <div className="max-w-4xl mx-auto p-8 print:p-0">
            <button
              onClick={() => setShowPrintView(false)}
              className="fixed top-4 right-4 px-4 py-2 bg-zinc-800 text-white rounded hover:bg-zinc-700 print:hidden"
            >
              Close
            </button>

            {results.map((r, reportIdx) => {
              const rDep = r.totalDeposited ?? 0;
              const rWith = r.totalWithdrawn ?? 0;
              const rCash = r.totalCashback ?? 0;
              const rPnl = r.totalPnl ?? 0;
              const rNet = rDep + rCash - rWith + rPnl;
              const rTrades = r.unifiedTrades ?? [];
              const rSolTxs = r.solTransactions ?? [];
              const isLast = reportIdx === results.length - 1;
              return (
                <div
                  key={r.address}
                  className={isLast ? "" : "break-after-page"}
                  style={isLast ? undefined : { pageBreakAfter: "always" }}
                >
                  <div className="text-center mb-8 pb-6 border-b-2 border-black">
                    <h1 className="text-2xl font-bold mb-2">CRYPTOCURRENCY TAX REPORT</h1>
                    <h2 className="text-lg text-gray-600">Solana Blockchain Transactions</h2>
                    {results.length > 1 && (
                      <p className="text-sm text-gray-600 mt-2">Wallet {reportIdx + 1} of {results.length}</p>
                    )}
                    <p className="text-sm text-gray-500 mt-4">
                      Report Generated: {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
                    </p>
                  </div>

                  <div className="mb-8 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Wallet Address:</p>
                      <a href={r.solscanProfileUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-xs break-all text-blue-600 hover:underline">
                        {r.address}
                      </a>
                    </div>
                    <div>
                      <p className="text-gray-500">Reporting Period:</p>
                      <p>{startDate || "Beginning"} — {endDate || "Present"}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Total Transactions Analyzed:</p>
                      <p>{r.totalTransactions?.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Currency:</p>
                      <p>SOL (Solana)</p>
                    </div>
                  </div>

                  <div className="mb-8">
                    <h3 className="text-lg font-bold mb-4 pb-2 border-b">1. SUMMARY</h3>
                    {solPrice && <p className="text-xs text-gray-500 mb-3">Exchange rate: 1 SOL = ${solPrice.toFixed(2)} USD (Binance)</p>}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-500 text-xs">
                          <th className="py-2"></th>
                          <th className="py-2 text-right">SOL</th>
                          {solPrice && <th className="py-2 text-right">USD</th>}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b">
                          <td className="py-2 text-gray-600">Total Deposits</td>
                          <td className="py-2 text-right font-mono">+{formatSol(rDep)}</td>
                          {solPrice && <td className="py-2 text-right font-mono text-gray-500">{formatUsd(rDep * solPrice)}</td>}
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 text-gray-600">Total Withdrawals</td>
                          <td className="py-2 text-right font-mono">-{formatSol(rWith)}</td>
                          {solPrice && <td className="py-2 text-right font-mono text-gray-500">{formatUsd(rWith * solPrice)}</td>}
                        </tr>
                        {rCash > 0 && (
                          <tr className="border-b">
                            <td className="py-2 text-gray-600">Cashback / Rewards Received</td>
                            <td className="py-2 text-right font-mono">+{formatSol(rCash)}</td>
                            {solPrice && <td className="py-2 text-right font-mono text-gray-500">{formatUsd(rCash * solPrice)}</td>}
                          </tr>
                        )}
                        <tr className="border-b">
                          <td className="py-2 text-gray-600">Trading Profit / Loss</td>
                          <td className={`py-2 text-right font-mono font-bold ${rPnl >= 0 ? "text-green-700" : "text-red-700"}`}>
                            {rPnl >= 0 ? "+" : ""}{formatSol(rPnl)}
                          </td>
                          {solPrice && (
                            <td className={`py-2 text-right font-mono ${rPnl >= 0 ? "text-green-700" : "text-red-700"}`}>
                              {rPnl >= 0 ? "+" : ""}{formatUsd(rPnl * solPrice)}
                            </td>
                          )}
                        </tr>
                        <tr className="bg-gray-100 font-bold">
                          <td className="py-3 px-2">NET RESULT (Deposits + Cashback − Withdrawals + PNL)</td>
                          <td className={`py-3 px-2 text-right font-mono ${rNet >= 0 ? "text-green-700" : "text-red-700"}`}>
                            {rNet >= 0 ? "+" : ""}{formatSol(rNet)}
                          </td>
                          {solPrice && (
                            <td className={`py-3 px-2 text-right font-mono ${rNet >= 0 ? "text-green-700" : "text-red-700"}`}>
                              {rNet >= 0 ? "+" : ""}{formatUsd(rNet * solPrice)}
                            </td>
                          )}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="mb-8">
                    <h3 className="text-lg font-bold mb-4 pb-2 border-b">2. TRADING ACTIVITY BY TOKEN</h3>
                    {rTrades.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b-2 text-left">
                            <th className="py-2 font-semibold">Token</th>
                            <th className="py-2 text-right font-semibold">Cost Basis (SOL)</th>
                            <th className="py-2 text-right font-semibold">Proceeds (SOL)</th>
                            <th className="py-2 text-right font-semibold">Gain/Loss (SOL)</th>
                            <th className="py-2 text-right font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rTrades.map((trade) => (
                            <tr key={trade.tokenMint} className="border-b">
                              <td className="py-2 font-mono">
                                <a href={`https://solscan.io/token/${trade.tokenMint}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                  {getTokenSymbol(trade.tokenMint, mintToSymbol)}
                                </a>
                              </td>
                              <td className="py-2 text-right font-mono">{formatSol(trade.totalSolSpent)}</td>
                              <td className="py-2 text-right font-mono">{formatSol(trade.totalSolReceived)}</td>
                              <td className={`py-2 text-right font-mono font-semibold ${trade.pnl >= 0 ? "text-green-700" : "text-red-700"}`}>
                                {trade.pnl >= 0 ? "+" : ""}{formatSol(trade.pnl)}
                              </td>
                              <td className="py-2 text-right">{trade.realized ? "Closed" : `Holding ${formatTokens(trade.tokensRemaining)}`}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 font-bold bg-gray-100">
                            <td className="py-2 px-1">TOTAL</td>
                            <td className="py-2 text-right font-mono px-1">{formatSol(rTrades.reduce((s, t) => s + t.totalSolSpent, 0))}</td>
                            <td className="py-2 text-right font-mono px-1">{formatSol(rTrades.reduce((s, t) => s + t.totalSolReceived, 0))}</td>
                            <td className={`py-2 text-right font-mono px-1 ${rPnl >= 0 ? "text-green-700" : "text-red-700"}`}>
                              {rPnl >= 0 ? "+" : ""}{formatSol(rPnl)}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    ) : (
                      <p className="text-gray-500 text-sm">No trading activity in this period.</p>
                    )}
                  </div>

                  <div className="mb-8">
                    <h3 className="text-lg font-bold mb-4 pb-2 border-b">3. DEPOSITS & WITHDRAWALS</h3>
                    {rSolTxs.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b-2 text-left">
                            <th className="py-2 font-semibold">Date</th>
                            <th className="py-2 font-semibold">Type</th>
                            <th className="py-2 font-semibold">Description</th>
                            <th className="py-2 text-right font-semibold">Amount (SOL)</th>
                            <th className="py-2 font-semibold">Transaction ID</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rSolTxs.map((tx, idx) => {
                            const label = customLabels[tx.signature] || tx.label;
                            return (
                              <tr key={`${tx.signature}-${idx}`} className="border-b">
                                <td className="py-1.5 font-mono">{tx.date}</td>
                                <td className="py-1.5">{tx.type === "deposit" ? "Deposit" : tx.type === "cashback" ? "Cashback" : "Withdrawal"}</td>
                                <td className="py-1.5">{label || "—"}</td>
                                <td className={`py-1.5 text-right font-mono ${tx.type === "withdrawal" ? "text-red-700" : "text-green-700"}`}>
                                  {tx.type === "withdrawal" ? "-" : "+"}{formatSol(tx.amount)}
                                </td>
                                <td className="py-1.5 font-mono">
                                  <a href={tx.solscanUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                    {shortSig(tx.signature)}
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-gray-500 text-sm">No deposits or withdrawals in this period.</p>
                    )}
                  </div>

                  <div className="mt-12 pt-6 border-t text-xs text-gray-500">
                    <h4 className="font-bold mb-2">DISCLAIMER</h4>
                    <p className="mb-2">
                      This report is generated for informational purposes only and does not constitute tax advice.
                      The information contained herein is derived from blockchain data and may not reflect all
                      taxable events or accurate market values at the time of transactions.
                    </p>
                    <p className="mb-2">
                      Cryptocurrency taxation varies by jurisdiction. Please consult with a qualified tax
                      professional to ensure compliance with applicable tax laws in your country.
                    </p>
                    <p>
                      All amounts are displayed in SOL (Solana). For tax filing purposes, you may need to
                      convert these values to your local fiat currency using historical exchange rates.
                    </p>
                  </div>

                  {isLast && (
                    <div className="mt-8 pt-4 border-t text-center text-xs text-gray-400">
                      <p>Generated by Solana Tax Analyzer • {new Date().toISOString()}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FAQ / Help modal */}
      {showFaq && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setShowFaq(false)}
        >
          <div
            className="max-w-lg w-full max-h-[85vh] overflow-y-auto rounded-xl bg-zinc-900 border border-zinc-800 p-6 text-sm text-zinc-300 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">FAQ / Help</h2>
              <button onClick={() => setShowFaq(false)} className="text-zinc-500 hover:text-white">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-zinc-200 mb-1">How does it work?</h3>
                <p>Enter a Solana wallet address and optionally choose a date range. The app fetches on-chain transactions, detects swaps and transfers, and computes PNL, deposits, withdrawals, and net flow. Use Export CSV/JSON/PDF for tax software.</p>
              </div>
              <div>
                <h3 className="font-medium text-zinc-200 mb-1">Limitations</h3>
                <p>Does not yet handle airdrops, forks, or staking rewards in detail. Token tickers may be shortened for some tokens (e.g. pump.fun). PnL and cost basis are in SOL using FIFO/LIFO/HIFO; USD on screen uses current SOL price. For accurate USD gains use historical prices: <code className="text-zinc-400">/api/sol-price-history?date=YYYY-MM-DD</code> (CoinGecko).</p>
              </div>
              <div>
                <h3 className="font-medium text-zinc-200 mb-1">Privacy &amp; security</h3>
                <p>Wallet data is public on Solana. This tool does not store your address or personal info. Analysis runs server-side; for maximum privacy you can self-host the app.</p>
              </div>
              <div>
                <h3 className="font-medium text-zinc-200 mb-1">Tips for accurate taxes</h3>
                <p>Choose a date range to speed up analysis. Use labels on transfers (e.g. &quot;Binance deposit&quot;). Export CSV or JSON for TurboTax, CoinTracker, or similar. Consult a tax professional for your jurisdiction.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Site footer: privacy + GitHub */}
      <footer className="mt-16 pt-8 pb-6 border-t border-zinc-800 text-xs text-zinc-500 text-center max-w-6xl mx-auto px-4">
        <p className="mb-2">
          Wallet data is public on Solana. This app does not store your address or personal information.
        </p>
        <p className="mb-3">
          Not tax advice. Consult a professional for your jurisdiction. Open source:{" "}
          <a
            href="https://github.com/meadowclarence38/solana-tax-analyzer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white underline"
          >
            GitHub
          </a>
        </p>
        <p>Solana Tax Analyzer</p>
      </footer>
    </div>
  );
}
