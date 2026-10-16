import "server-only";

// Product search. Uses the Channel3 API (https://trychannel3.com) when CHANNEL3_API_KEY is set,
// otherwise a small built-in sample catalog so the app still runs end to end.

export interface ProductHit {
  title: string;
  merchant: string;
  url: string;
  imageUrl: string | null;
  priceCents: number;
  currency: string;
  inStock: boolean;
  source: "channel3" | "sample";
}

export function productSource(): "channel3" | "sample" {
  return process.env.CHANNEL3_API_KEY ? "channel3" : "sample";
}

export async function searchProducts(query: string, maxPriceUsd?: number): Promise<ProductHit[]> {
  return productSource() === "channel3" ? searchChannel3(query, maxPriceUsd) : searchSample(query, maxPriceUsd);
}

// Channel3 responses are read defensively: only the fields we need, with fallbacks for naming differences.
type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

async function searchChannel3(query: string, maxPriceUsd?: number): Promise<ProductHit[]> {
  const body: Json = { query, limit: 8 };
  if (maxPriceUsd) body.filters = { price: { max_price: maxPriceUsd } };
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": process.env.CHANNEL3_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Channel3 search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as Json;
  const products = (Array.isArray(data) ? data : (data.products as Json[] | undefined)) ?? [];

  const hits: ProductHit[] = [];
  for (const p of products as Json[]) {
    const offers = (Array.isArray(p.offers) ? p.offers : []) as Json[];
    const offer = offers.find((o) => o.availability === "InStock") ?? offers[0];
    const priceObj = (offer?.price ?? p.price) as Json | number | undefined;
    const price =
      typeof priceObj === "number" ? priceObj : typeof priceObj === "object" ? Number(priceObj?.price) : NaN;
    if (!offer || !Number.isFinite(price) || price <= 0) continue;
    const images = (Array.isArray(p.images) ? p.images : []) as (Json | string)[];
    const firstImage = images[0];
    const imageUrl =
      typeof firstImage === "string" ? firstImage : str(firstImage?.url) ?? str(p.image_url) ?? null;
    hits.push({
      title: str(p.title) ?? "Untitled product",
      merchant: str(offer.domain) ?? str((p.brand as Json | undefined)?.name) ?? str(p.brand_name) ?? "Unknown store",
      url: str(offer.url) ?? str(p.url) ?? "",
      imageUrl,
      priceCents: Math.round(price * 100),
      currency: (typeof priceObj === "object" && str(priceObj?.currency)) || "USD",
      inStock: offer.availability ? offer.availability === "InStock" : true,
      source: "channel3",
    });
  }
  return hits;
}

const SAMPLE: Omit<ProductHit, "source" | "inStock">[] = [
  { title: 'Dell UltraSharp 27" 4K USB-C Monitor (U2723QE)', merchant: "dell.com", url: "https://www.dell.com/", imageUrl: null, priceCents: 51999, currency: "USD" },
  { title: 'LG 27" UltraFine 4K IPS Monitor (27UP850-W)', merchant: "bestbuy.com", url: "https://www.bestbuy.com/", imageUrl: null, priceCents: 34999, currency: "USD" },
  { title: 'ASUS ProArt 27" 1440p Calibrated Monitor (PA278QV)', merchant: "amazon.com", url: "https://www.amazon.com/", imageUrl: null, priceCents: 28999, currency: "USD" },
  { title: 'Samsung 27" ViewFinity S6 QHD Monitor', merchant: "samsung.com", url: "https://www.samsung.com/", imageUrl: null, priceCents: 19999, currency: "USD" },
  { title: "Logitech MX Master 3S Wireless Mouse", merchant: "logitech.com", url: "https://www.logitech.com/", imageUrl: null, priceCents: 9999, currency: "USD" },
  { title: "Keychron K3 Pro Low-Profile Mechanical Keyboard", merchant: "keychron.com", url: "https://www.keychron.com/", imageUrl: null, priceCents: 11900, currency: "USD" },
  { title: "Herman Miller Aeron Ergonomic Chair, Size B", merchant: "hermanmiller.com", url: "https://www.hermanmiller.com/", imageUrl: null, priceCents: 180500, currency: "USD" },
  { title: "Steelcase Series 2 Office Chair", merchant: "steelcase.com", url: "https://www.steelcase.com/", imageUrl: null, priceCents: 64900, currency: "USD" },
  { title: "Branch Ergonomic Chair", merchant: "branchfurniture.com", url: "https://www.branchfurniture.com/", imageUrl: null, priceCents: 49900, currency: "USD" },
  { title: "Anker 735 USB-C Charger (65W, 3 ports)", merchant: "anker.com", url: "https://www.anker.com/", imageUrl: null, priceCents: 4999, currency: "USD" },
  { title: "Figma Professional, 1 seat (annual)", merchant: "figma.com", url: "https://www.figma.com/", imageUrl: null, priceCents: 18000, currency: "USD" },
  { title: "JetBrains IntelliJ IDEA Ultimate, 1 seat (annual)", merchant: "jetbrains.com", url: "https://www.jetbrains.com/", imageUrl: null, priceCents: 59900, currency: "USD" },
  { title: "Moleskine Classic Notebook, 3-pack", merchant: "moleskine.com", url: "https://www.moleskine.com/", imageUrl: null, priceCents: 3495, currency: "USD" },
  { title: "Avery Shipping Labels, 300 pack", merchant: "staples.com", url: "https://www.staples.com/", imageUrl: null, priceCents: 2849, currency: "USD" },
  { title: "Sony WH-1000XM5 Noise-Cancelling Headphones", merchant: "sony.com", url: "https://www.sony.com/", imageUrl: null, priceCents: 39999, currency: "USD" },
  { title: "Amazon Gift Card, $100", merchant: "amazon.com", url: "https://www.amazon.com/", imageUrl: null, priceCents: 10000, currency: "USD" },
  { title: '"Refactoring UI" ebook', merchant: "refactoringui.com", url: "https://www.refactoringui.com/", imageUrl: null, priceCents: 9900, currency: "USD" },
];

async function searchSample(query: string, maxPriceUsd?: number): Promise<ProductHit[]> {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const scored = SAMPLE.map((p) => ({
    p,
    score: words.filter((w) => p.title.toLowerCase().includes(w.replace(/s$/, ""))).length,
  }))
    .filter((x) => x.score > 0)
    .filter((x) => !maxPriceUsd || x.p.priceCents <= maxPriceUsd * 100)
    .sort((a, b) => b.score - a.score || a.p.priceCents - b.p.priceCents)
    .slice(0, 6);
  return scored.map(({ p }) => ({ ...p, inStock: true, source: "sample" as const }));
}
