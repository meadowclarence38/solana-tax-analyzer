import { Connection, PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const META_FETCH_DELAY_MS = 80; // Small delay between getAccountInfo calls to avoid 429
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Metaplex Metadata: key(1) + update_authority(32) + mint(32) + data{ name(len+str), symbol(len+str), uri(...) }
// Try a few possible data starts in case key or layout varies (V1/V2/V3, pump.fun, etc.)
function parseNameAndSymbol(data: Buffer): { name: string | null; symbol: string | null } {
  if (data.length < 69) return { name: null, symbol: null };
  const tryAt = (dataStart: number) => {
    let off = dataStart;
    const readU32 = () => {
      if (off + 4 > data.length) return null;
      const v = data.readUInt32LE(off);
      off += 4;
      return v;
    };
    const nameLen = readU32();
    if (nameLen == null || nameLen > 64 || off + nameLen > data.length) return null;
    const name = data.subarray(off, off + nameLen).toString("utf8").replace(/\0/g, "").trim();
    off += nameLen;
    const symbolLen = readU32();
    if (symbolLen == null || symbolLen > 32 || off + symbolLen > data.length) return null;
    const symbol = data.subarray(off, off + symbolLen).toString("utf8").replace(/\0/g, "").trim();
    if (!symbol || !/^[\x20-\x7E]+$/.test(symbol)) return null; // printable ASCII
    return { name: name || null, symbol };
  };
  for (const dataStart of [65, 64, 66]) {
    const result = tryAt(dataStart);
    if (result?.symbol) return result;
  }
  return { name: null, symbol: null };
}

// Fallback for pump.fun and other tokens: Jupiter lite API returns symbol by mint
const JUPITER_LITE_SEARCH = "https://lite-api.jup.ag/tokens/v2/search";
async function fetchSymbolFromJupiter(mint: string): Promise<string | null> {
  try {
    const res = await fetch(`${JUPITER_LITE_SEARCH}?query=${encodeURIComponent(mint)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const token = Array.isArray(data) ? data[0] : data?.data?.[0];
    if (token?.symbol && token?.id === mint) return String(token.symbol).trim();
    return null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mintsParam = searchParams.get("mints");
  if (!mintsParam || typeof mintsParam !== "string") {
    return NextResponse.json({ mintToSymbol: {} });
  }
  const mints = mintsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 50);
  if (mints.length === 0) {
    return NextResponse.json({ mintToSymbol: {} });
  }

  const connection = new Connection(RPC, "confirmed");
  const mintToSymbol: Record<string, string> = {};
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < mints.length; i++) {
    if (i > 0) await delay(META_FETCH_DELAY_MS);
    const mint = mints[i];
    try {
      const mintPubkey = new PublicKey(mint);
      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      const accountInfo = await connection.getAccountInfo(metadataPda);
      if (accountInfo?.data) {
        const { symbol } = parseNameAndSymbol(Buffer.from(accountInfo.data));
        if (symbol) {
          mintToSymbol[mint] = symbol;
          continue;
        }
      }
      // Fallback for pump.fun and other tokens: Jupiter lite API has symbol by mint
      const symbol = await fetchSymbolFromJupiter(mint);
      if (symbol) mintToSymbol[mint] = symbol;
      await delay(120); // delay after Jupiter to avoid rate limit
    } catch {
      // skip invalid mint or RPC error
    }
  }

  return NextResponse.json({ mintToSymbol });
}
