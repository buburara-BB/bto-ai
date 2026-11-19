import type { RakutenItem } from "./types";
import { cached } from "./cache";

const ENDPOINT =
  process.env.RAKUTEN_ENDPOINT ||
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601";

export const rakutenEnabled = () =>
  !!(process.env.RAKUTEN_APP_ID && process.env.RAKUTEN_ACCESS_KEY);

const BASE = "ゲーミングPC デスクトップ";
const MIN_PRICE = 80_000;

const NG_TITLE =
  /中古|リファービッシュ|ジャンク|訳あり|グラフィックボード|マザーボード|PCケース|モニター|ディスプレイ|キーボード|マウス(?!コンピューター)|ヘッドセット|電源ユニット|ノートパソコン|ノートPC|ゲーミングノート|チェア|ゲーミングデスク(?!トップ)|カバー|ケーブル/;
const PC_HINT = /PC|パソコン|ゲーミング|RTX|Ryzen|Core|GALLERIA|LEVEL|G-?Tune|FRONTIER/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildKeywords(query: string, tags: string[]): string[] {
  const text = `${query} ${tags.join(" ")}`;
  const color = /白|ホワイト/.test(text) ? " ホワイト" : "";
  const parts: string[] = [];

  const gpu = text.match(/RTX\s?-?(\d{4})(\s?Ti)?(\s?SUPER)?/i);
  if (gpu) parts.push(`RTX${gpu[1]}${gpu[2] ? " Ti" : ""}${gpu[3] ? " SUPER" : ""}`);
  const ryzen = text.match(/Ryzen\s?([3579])/i);
  if (ryzen) parts.push(`Ryzen ${ryzen[1]}`);
  const intel = text.match(/Core\s?(i[3579])/i);
  if (intel) parts.push(`Core ${intel[1]}`);

  const list = [
    `${BASE}${color}${parts.length ? " " + parts.join(" ") : ""}`,
    `${BASE}${color}`,
    BASE,
  ];
  return Array.from(new Set(list));
}

function normalize(r: any): RakutenItem | null {
  const name = typeof r?.itemName === "string" ? r.itemName : "";
  const price = Number(r?.itemPrice);
  const url = r?.affiliateUrl || r?.itemUrl;
  if (!name || !Number.isFinite(price) || !url) return null;
  const img0 = Array.isArray(r.mediumImageUrls) ? r.mediumImageUrls[0] : null;
  const image =
    typeof img0 === "string" ? img0 : typeof img0?.imageUrl === "string" ? img0.imageUrl : null;
  return {
    id: String(r.itemCode || url),
    name,
    price,
    shop: String(r.shopName || ""),
    url,
    image: image ? image.replace(/\?_ex=\d+x\d+/, "") : null,
    reviewAverage: Number.isFinite(Number(r.reviewAverage)) ? Number(r.reviewAverage) : null,
    reviewCount: Number(r.reviewCount) || 0,
  };
}

async function fetchRaw(keyword: string, maxPrice: number): Promise<RakutenItem[]> {
  const params = new URLSearchParams({
    format: "json",
    formatVersion: "2",
    applicationId: process.env.RAKUTEN_APP_ID!,
    accessKey: process.env.RAKUTEN_ACCESS_KEY!,
    keyword,
    hits: "30",
    minPrice: String(MIN_PRICE),
    maxPrice: String(maxPrice),
    availability: "1",
    NGKeyword: "中古 リファービッシュ ジャンク",
  });
  if (process.env.RAKUTEN_AFFILIATE_ID) params.set("affiliateId", process.env.RAKUTEN_AFFILIATE_ID);

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: { Referer: process.env.RAKUTEN_REFERER || "http://localhost:3000" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`RAKUTEN_${res.status}`);
  const data = await res.json();
  const rows: any[] = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.Items)
    ? data.Items.map((x: any) => x.Item)
    : [];
  return rows.map(normalize).filter((x): x is RakutenItem => x !== null);
}

export async function searchRakuten(
  query: string,
  tags: string[],
  budget: number
): Promise<RakutenItem[]> {
  const keywords = buildKeywords(query, tags);
  const seen = new Map<string, RakutenItem>();

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const { value } = await cached(`rk:${kw}:${budget}`, 60 * 60 * 1000, async () => ({
      value: await fetchRaw(kw, budget),
      cache: true,
    }));
    for (const it of value) {
      if (NG_TITLE.test(it.name) || !PC_HINT.test(it.name)) continue;
      if (!seen.has(it.id)) seen.set(it.id, it);
    }
    if (seen.size >= 8) break;
    if (i < keywords.length - 1) await sleep(1100);
  }
  return Array.from(seen.values());
    }
