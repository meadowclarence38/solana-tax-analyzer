import { NextResponse } from "next/server";

const COINGECKO_SOL_HISTORY = "https://api.coingecko.com/api/v3/coins/solana/history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Convert YYYY-MM-DD to dd-mm-yyyy for CoinGecko */
function toCoinGeckoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
}

/**
 * GET /api/sol-price-history?date=YYYY-MM-DD
 * Returns SOL price in USD at 00:00 UTC for the given date (for cost basis / realized gain in USD).
 * Uses CoinGecko free API; rate limits apply.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: "Query param 'date' required as YYYY-MM-DD" },
        { status: 400 }
      );
    }
    const dateStr = toCoinGeckoDate(dateParam);
    const url = `${COINGECKO_SOL_HISTORY}?date=${dateStr}&localization=false`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 }, // cache 24h per date
    });
    if (!res.ok) {
      if (res.status === 429) {
        return NextResponse.json(
          { error: "CoinGecko rate limit; try again later" },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: "Failed to fetch historical price" },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      market_data?: { current_price?: { usd?: number } };
    };
    const priceUsd = data?.market_data?.current_price?.usd;
    if (typeof priceUsd !== "number") {
      return NextResponse.json(
        { error: "No price data for this date" },
        { status: 404 }
      );
    }
    return NextResponse.json({ date: dateParam, priceUsd });
  } catch (e) {
    console.error("SOL price history fetch failed:", e);
    return NextResponse.json(
      { error: "Failed to fetch historical price" },
      { status: 500 }
    );
  }
}
