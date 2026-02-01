import { NextResponse } from "next/server";

const SOLANA_TOKEN_LIST_URL =
  "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const res = await fetch(SOLANA_TOKEN_LIST_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    const data = await res.json();
    if (!Array.isArray(data?.tokens)) {
      return NextResponse.json({ mintToSymbol: {} });
    }
    const mintToSymbol: Record<string, string> = {};
    for (const t of data.tokens) {
      if (t?.address && t?.symbol) mintToSymbol[t.address] = t.symbol;
    }
    return NextResponse.json({ mintToSymbol });
  } catch (e) {
    console.error("Token list fetch failed:", e);
    return NextResponse.json({ mintToSymbol: {} });
  }
}
