export type Bto = {
  id: string;
  maker: string;
  name: string;
  cpu: string;
  gpu: string;
  ram: string;
  storage: string;
  color: string;
  price: number;
  tags: string[];
  note: string;
  url: string;
};

export type RakutenItem = {
  id: string;
  name: string;
  price: number;
  shop: string;
  url: string;
  image: string | null;
  reviewAverage: number | null;
  reviewCount: number;
};

export type SearchPick = {
  source: "rakuten" | "demo";
  maker: string;
  name: string;
  cpu: string;
  gpu: string;
  ram: string;
  storage: string;
  price: number;
  url: string;
  image?: string | null;
  reason: string;
};

export type SearchResult = {
  picks: SearchPick[];
  note?: string;
  source: "rakuten" | "demo";
  cached?: boolean;
  degraded?: boolean;
};

export type Warning = {
  category: string;
  severity: "high" | "mid" | "low";
  title: string;
  detail: string;
};

export type DiagnoseResult = {
  grade: "S" | "A" | "B" | "C" | "D";
  summary: string;
  warnings: Warning[];
  diyTotal: number;
  bto: { model: Bto; reason: string } | null;
  cached?: boolean;
};

export type PartsInput = {
  cpu: string;
  gpu: string;
  mb: string;
  ram: string;
  psu: string;
  pcCase: string;
};
