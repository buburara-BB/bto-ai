const AMAZON_TAG = process.env.NEXT_PUBLIC_AMAZON_TAG || "";

export function amazonSearchUrl(keyword: string): string {
  const q = encodeURIComponent(keyword);
  return `https://www.amazon.co.jp/s?k=${q}${AMAZON_TAG ? `&tag=${AMAZON_TAG}` : ""}`;
}

export function rakutenSearchUrl(keyword: string): string {
  return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/`;
}
