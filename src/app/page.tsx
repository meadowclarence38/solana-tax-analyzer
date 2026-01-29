"use client";

import { useState, useEffect, Fragment } from "react";
import type { AnalysisResult } from "@/types/analyze";

// Custom labels storage key
const LABELS_STORAGE_KEY = "solana-tax-analyzer-labels";

// Binance API for SOL price
const BINANCE_SOL_PRICE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";

function shortMint(mint: string): string {
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedToken, setExpandedToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"trades" | "transfers">("trades");
  const [datePreset, setDatePreset] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showPrintView, setShowPrintView] = useState(false);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  
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

  async function handleAnalyze() {
    if (!address.trim()) {
      setError("Enter a Solana address");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          address: address.trim(),
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Analysis failed");
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const unifiedTrades = result?.unifiedTrades ?? [];
  const solTransactions = result?.solTransactions ?? [];
  const totalPnl = result?.totalPnl ?? 0;
  const totalDeposited = result?.totalDeposited ?? 0;
  const totalWithdrawn = result?.totalWithdrawn ?? 0;
  const totalCashback = result?.totalCashback ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-12">
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Solana Tax Analyzer
          </h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Trading history and PNL analysis
          </p>
        </header>

        {/* Search Section */}
        <div className="space-y-4 mb-10">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Enter wallet address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              className="flex-1 px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-mono text-sm"
            />
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="px-6 py-3 rounded-lg bg-white text-zinc-900 font-medium text-sm hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Loading..." : "Analyze"}
            </button>
          </div>

          {/* Date Filter */}
          <div className="flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handlePresetChange(preset.value)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  datePreset === preset.value
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {preset.label}
              </button>
            ))}
            {datePreset === "custom" && (
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-white text-xs"
                />
                <span className="text-zinc-600">—</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-white text-xs"
                />
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-8 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mb-8 p-4 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 text-sm">
            Fetching transactions... This may take a few minutes.
          </div>
        )}

        {/* Results */}
        {result && (
          <>
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
              <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
                <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Net Flow</div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-semibold font-mono ${(totalDeposited - totalWithdrawn + totalPnl) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {(totalDeposited - totalWithdrawn + totalPnl) >= 0 ? '+' : ''}{formatSol(totalDeposited - totalWithdrawn + totalPnl)}
                  </span>
                  {solPrice && (
                    <span className={`text-xs font-mono ${(totalDeposited - totalWithdrawn + totalPnl) >= 0 ? 'text-green-500/50' : 'text-red-500/50'}`}>
                      {(totalDeposited - totalWithdrawn + totalPnl) >= 0 ? '+' : ''}{formatUsd((totalDeposited - totalWithdrawn + totalPnl) * solPrice)}
                    </span>
                  )}
                </div>
              </div>
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
              <button
                onClick={handlePrint}
                className="px-4 py-1.5 text-xs font-medium text-zinc-400 hover:text-white border border-zinc-700 rounded hover:border-zinc-500 transition-colors print:hidden"
              >
                Export PDF
              </button>
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
                              {shortMint(trade.tokenMint)}
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
                                    <div key={idx} className="flex items-center gap-4 text-xs py-1 group/row">
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
            <div className="mt-8 flex items-center justify-between text-xs text-zinc-600">
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
              Enter a wallet address to analyze trading history
            </p>
          </div>
        )}
      </div>

      {/* Print View - Tax Report */}
      {showPrintView && result && (
        <div className="fixed inset-0 bg-white text-black z-50 overflow-auto print:relative print:z-auto" id="print-view">
          <div className="max-w-4xl mx-auto p-8 print:p-0">
            {/* Close button - hidden in print */}
            <button
              onClick={() => setShowPrintView(false)}
              className="fixed top-4 right-4 px-4 py-2 bg-zinc-800 text-white rounded hover:bg-zinc-700 print:hidden"
            >
              Close
            </button>

            {/* Report Header */}
            <div className="text-center mb-8 pb-6 border-b-2 border-black">
              <h1 className="text-2xl font-bold mb-2">CRYPTOCURRENCY TAX REPORT</h1>
              <h2 className="text-lg text-gray-600">Solana Blockchain Transactions</h2>
              <p className="text-sm text-gray-500 mt-4">
                Report Generated: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
              </p>
            </div>

            {/* Report Info */}
            <div className="mb-8 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Wallet Address:</p>
                <a 
                  href={result.solscanProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs break-all text-blue-600 hover:underline"
                >
                  {result.address}
                </a>
              </div>
              <div>
                <p className="text-gray-500">Reporting Period:</p>
                <p>{startDate || 'Beginning'} — {endDate || 'Present'}</p>
              </div>
              <div>
                <p className="text-gray-500">Total Transactions Analyzed:</p>
                <p>{result.totalTransactions?.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-500">Currency:</p>
                <p>SOL (Solana)</p>
              </div>
            </div>

            {/* Summary Section */}
            <div className="mb-8">
              <h3 className="text-lg font-bold mb-4 pb-2 border-b">1. SUMMARY</h3>
              {solPrice && (
                <p className="text-xs text-gray-500 mb-3">Exchange rate: 1 SOL = ${solPrice.toFixed(2)} USD (Binance)</p>
              )}
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
                    <td className="py-2 text-right font-mono">+{formatSol(totalDeposited)}</td>
                    {solPrice && <td className="py-2 text-right font-mono text-gray-500">{formatUsd(totalDeposited * solPrice)}</td>}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-gray-600">Total Withdrawals</td>
                    <td className="py-2 text-right font-mono">-{formatSol(totalWithdrawn)}</td>
                    {solPrice && <td className="py-2 text-right font-mono text-gray-500">{formatUsd(totalWithdrawn * solPrice)}</td>}
                  </tr>
                  {totalCashback > 0 && (
                    <tr className="border-b">
                      <td className="py-2 text-gray-600">Cashback / Rewards Received</td>
                      <td className="py-2 text-right font-mono">+{formatSol(totalCashback)}</td>
                      {solPrice && <td className="py-2 text-right font-mono text-gray-500">{formatUsd(totalCashback * solPrice)}</td>}
                    </tr>
                  )}
                  <tr className="border-b">
                    <td className="py-2 text-gray-600">Trading Profit / Loss</td>
                    <td className={`py-2 text-right font-mono font-bold ${totalPnl >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {totalPnl >= 0 ? '+' : ''}{formatSol(totalPnl)}
                    </td>
                    {solPrice && (
                      <td className={`py-2 text-right font-mono ${totalPnl >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {totalPnl >= 0 ? '+' : ''}{formatUsd(totalPnl * solPrice)}
                      </td>
                    )}
                  </tr>
                  <tr className="bg-gray-100 font-bold">
                    <td className="py-3 px-2">NET RESULT</td>
                    <td className={`py-3 px-2 text-right font-mono ${(totalDeposited - totalWithdrawn + totalPnl) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {(totalDeposited - totalWithdrawn + totalPnl) >= 0 ? '+' : ''}{formatSol(totalDeposited - totalWithdrawn + totalPnl)}
                    </td>
                    {solPrice && (
                      <td className={`py-3 px-2 text-right font-mono ${(totalDeposited - totalWithdrawn + totalPnl) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {(totalDeposited - totalWithdrawn + totalPnl) >= 0 ? '+' : ''}{formatUsd((totalDeposited - totalWithdrawn + totalPnl) * solPrice)}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Trading Activity */}
            <div className="mb-8">
              <h3 className="text-lg font-bold mb-4 pb-2 border-b">2. TRADING ACTIVITY BY TOKEN</h3>
              {unifiedTrades.length > 0 ? (
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
                    {unifiedTrades.map((trade) => (
                      <tr key={trade.tokenMint} className="border-b">
                        <td className="py-2 font-mono">
                          <a 
                            href={`https://solscan.io/token/${trade.tokenMint}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {shortMint(trade.tokenMint)}
                          </a>
                        </td>
                        <td className="py-2 text-right font-mono">{formatSol(trade.totalSolSpent)}</td>
                        <td className="py-2 text-right font-mono">{formatSol(trade.totalSolReceived)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${trade.pnl >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {trade.pnl >= 0 ? '+' : ''}{formatSol(trade.pnl)}
                        </td>
                        <td className="py-2 text-right">
                          {trade.realized ? 'Closed' : `Holding ${formatTokens(trade.tokensRemaining)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-bold bg-gray-100">
                      <td className="py-2 px-1">TOTAL</td>
                      <td className="py-2 text-right font-mono px-1">
                        {formatSol(unifiedTrades.reduce((sum, t) => sum + t.totalSolSpent, 0))}
                      </td>
                      <td className="py-2 text-right font-mono px-1">
                        {formatSol(unifiedTrades.reduce((sum, t) => sum + t.totalSolReceived, 0))}
                      </td>
                      <td className={`py-2 text-right font-mono px-1 ${totalPnl >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {totalPnl >= 0 ? '+' : ''}{formatSol(totalPnl)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <p className="text-gray-500 text-sm">No trading activity in this period.</p>
              )}
            </div>

            {/* Deposits & Withdrawals */}
            <div className="mb-8">
              <h3 className="text-lg font-bold mb-4 pb-2 border-b">3. DEPOSITS & WITHDRAWALS</h3>
              {solTransactions.length > 0 ? (
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
                    {solTransactions.map((tx, idx) => {
                      const label = customLabels[tx.signature] || tx.label;
                      return (
                        <tr key={`${tx.signature}-${idx}`} className="border-b">
                          <td className="py-1.5 font-mono">{tx.date}</td>
                          <td className="py-1.5">
                            {tx.type === 'deposit' ? 'Deposit' : tx.type === 'cashback' ? 'Cashback' : 'Withdrawal'}
                          </td>
                          <td className="py-1.5">{label || '—'}</td>
                          <td className={`py-1.5 text-right font-mono ${
                            tx.type === 'withdrawal' ? 'text-red-700' : 'text-green-700'
                          }`}>
                            {tx.type === 'withdrawal' ? '-' : '+'}{formatSol(tx.amount)}
                          </td>
                          <td className="py-1.5 font-mono">
                            <a 
                              href={tx.solscanUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
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

            {/* Disclaimer */}
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

            {/* Footer */}
            <div className="mt-8 pt-4 border-t text-center text-xs text-gray-400">
              <p>Generated by Solana Tax Analyzer • {new Date().toISOString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
