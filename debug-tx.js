// Debug script to inspect transaction structure
const { Connection } = require("@solana/web3.js");

const RPC = "https://mainnet.helius-rpc.com/?api-key=b4718a9d-2973-4678-8297-fc4a9e1df772";

// Buy transaction
const BUY_TX = "3UoQ9ReRcK6PeHP1uaR3W3EHvJuKuumzUjRJQrNp7hTrrRqJezkXEiQzmTjKm5DRHiYh4HtPgwhoiKsKB9vhhASu";
// Sell transaction  
const SELL_TX = "65GPR91ThixwG3sqZ9kvSwbUDEyo57DAzAgHJH4WAhwucCncqfrgmZy8ApK26VmviyCLUBjG3XxPZ3eva4pmC5BS";

const TX_SIGS = [
  { name: "BUY", sig: BUY_TX },
  { name: "SELL", sig: SELL_TX }
];

async function inspectTx(connection, name, sig) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`=== ${name} TRANSACTION: ${sig.slice(0,20)}... ===`);
  console.log("=".repeat(60));
  
  const tx = await connection.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
  });
  
  if (!tx) {
    console.log("Transaction not found");
    return;
  }

  console.log("\n--- TRANSACTION INFO ---");
  console.log("Block time:", tx.blockTime, new Date(tx.blockTime * 1000).toISOString());
  console.log("Slot:", tx.slot);
  console.log("Error:", tx.meta?.err);
  
  console.log("\n--- ACCOUNT KEYS (first 5) ---");
  tx.transaction.message.accountKeys.slice(0, 5).forEach((key, i) => {
    const pubkey = typeof key === "string" ? key : key.pubkey.toString();
    console.log(`  [${i}] ${pubkey}`);
  });
  
  console.log("\n--- SOL BALANCE CHANGES ---");
  const preBalances = tx.meta?.preBalances || [];
  const postBalances = tx.meta?.postBalances || [];
  preBalances.forEach((pre, i) => {
    const post = postBalances[i] || 0;
    const diff = (post - pre) / 1e9;
    if (Math.abs(diff) > 0.0001) {
      console.log(`  [${i}] ${(pre/1e9).toFixed(4)} -> ${(post/1e9).toFixed(4)} SOL (diff: ${diff > 0 ? '+' : ''}${diff.toFixed(4)})`);
    }
  });
  
  console.log("\n--- PRE TOKEN BALANCES ---");
  (tx.meta?.preTokenBalances || []).forEach((t) => {
    console.log(`  [${t.accountIndex}] mint=${t.mint.slice(0,8)}... owner=${t.owner?.slice(0,8) || 'N/A'}... amount=${t.uiTokenAmount?.uiAmount}`);
  });
  
  console.log("\n--- POST TOKEN BALANCES ---");
  (tx.meta?.postTokenBalances || []).forEach((t) => {
    console.log(`  [${t.accountIndex}] mint=${t.mint.slice(0,8)}... owner=${t.owner?.slice(0,8) || 'N/A'}... amount=${t.uiTokenAmount?.uiAmount}`);
  });
  
  console.log("\n--- MAIN INSTRUCTIONS ---");
  tx.transaction.message.instructions.forEach((ix, i) => {
    const programId = ix.programId?.toString() || ix.program;
    console.log(`  [${i}] program: ${programId?.slice(0,12)}...`);
    if (ix.parsed) {
      console.log(`       type: ${ix.parsed.type}`);
    }
  });
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  
  for (const { name, sig } of TX_SIGS) {
    await inspectTx(connection, name, sig);
  }
}

main().catch(console.error);
