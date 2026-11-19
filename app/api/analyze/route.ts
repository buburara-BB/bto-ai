import { NextRequest, NextResponse } from "next/server";
import { BTO_MODELS } from "@/lib/btoData";
import { cached } from "@/lib/cache";
import { callGemini, clean } from "@/lib/gemini";
import { rakutenEnabled, searchRakuten } from "@/lib/rakuten";
import type { Bto, SearchPick, SearchResult, Warning } from "@/lib/types";

export const runtime = "nodejs";

const SEARCH_TTL = 6 * 60 * 60 * 1000;
const DIAG_TTL = 24 * 60 * 60 * 1000;

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 10;
}

const slim = (m: Bto) => ({
  id: m.id, maker: m.maker, name: m.name, cpu: m.cpu, gpu: m.gpu,
  ram: m.ram, storage: m.storage, color: m.color, price: m.price, tags: m.tags, note: m.note,
});

// ---------------- タブA：検索 ----------------
async function pickFromRakuten(
  query: string, tags: string[], budget: number, items: Awaited<ReturnType<typeof searchRakuten>>
): Promise<SearchResult> {
  const cands = items.slice(0, 15).map((it, i) => ({
    id: `c${i}`, name: it.name.slice(0, 160), price: it.price, shop: it.shop,
    reviewAverage: it.reviewAverage, reviewCount: it.reviewCount,
  }));

  const prompt = `あなたは日本のゲーミングPCに詳しい販売アドバイザーです。
下の「楽天市場の実在商品リスト」の中から、ユーザーの要望に合う商品を最大3つ選んでください。リストにない商品は絶対に作らないこと。
予算上限: ${budget}円 / 用途タグ: ${tags.join(", ") || "指定なし"} / 要望: ${query || "指定なし"}
商品リスト(JSON): ${JSON.stringify(cands)}

出力はJSONのみ。形式:
{"picks":[{"id":"c0","cpu":"","gpu":"","ram":"","storage":"","reason":"初心者にも分かる日本語で80〜120字。要望のどこに合うか＋注意点を1つ"}],"note":"全体への一言(任意)"}
ルール: cpu/gpu/ram/storage は商品名に書かれている場合のみ記入。書かれていなければ「商品名参照」と書く。推測や補完は禁止。ベスト順に並べる。`;

  try {
    const ai = await callGemini(prompt);
    const picks: SearchPick[] = (Array.isArray(ai.picks) ? ai.picks : [])
      .flatMap((p: any) => {
        const idx = cands.findIndex((c) => c.id === p?.id);
        if (idx < 0) return [];
        const it = items[idx];
        return [{
          source: "rakuten" as const,
          maker: it.shop,
          name: it.name,
          cpu: clean(p.cpu, 40) || "商品名参照",
          gpu: clean(p.gpu, 40) || "商品名参照",
          ram: clean(p.ram, 40) || "商品名参照",
          storage: clean(p.storage, 40) || "商品名参照",
          price: it.price,
          url: it.url,
          image: it.image,
          reason: clean(p.reason, 300),
        }];
      })
      .slice(0, 3);
    if (picks.length === 0) throw new Error("EMPTY");
    return { picks, note: clean(ai.note, 300), source: "rakuten" };
  } catch {
    const picks: SearchPick[] = [...items]
      .sort((a, b) => b.reviewCount - a.reviewCount)
      .slice(0, 3)
      .map((it) => ({
        source: "rakuten" as const, maker: it.shop, name: it.name,
        cpu: "商品名参照", gpu: "商品名参照", ram: "商品名参照", storage: "商品名参照",
        price: it.price, url: it.url, image: it.image,
        reason: "AIが混み合っているため、レビュー件数の多い順に表示しています(簡易モード)。",
      }));
    return { picks, source: "rakuten", degraded: true };
  }
}

function pickFromDemo(query: string, tags: string[], budget: number, degraded: boolean): SearchResult {
  let pool = BTO_MODELS.filter((m) => m.price <= budget);
  if (pool.length < 3) {
    pool = [...BTO_MODELS]
      .sort((a, b) => Math.abs(a.price - budget) - Math.abs(b.price - budget))
      .slice(0, 5);
  }
  const score = (m: Bto) => {
    let s = tags.filter((t) => m.tags.includes(t)).length * 3;
    if (/白|ホワイト/.test(query) && m.color === "白") s += 5;
    if (/ryzen\s*7/i.test(query) && /ryzen 7/i.test(m.cpu)) s += 2;
    if (/4070/.test(query) && /4070/.test(m.gpu)) s += 3;
    return s;
  };
  const picks: SearchPick[] = [...pool]
    .sort((a, b) => score(b) - score(a) || b.price - a.price)
    .slice(0, 3)
    .map((m) => ({
      source: "demo" as const, maker: `${m.maker} ${m.name}`, name: m.name,
      cpu: m.cpu, gpu: m.gpu, ram: m.ram, storage: m.storage, price: m.price, url: m.url,
      reason: `${m.note}(デモデータ)`,
    }));
  return { picks, source: "demo", degraded, note: "楽天APIが未設定、または取得に失敗したためデモデータを表示しています。" };
}

async function runSearch(query: string, tags: string[], budget: number): Promise<SearchResult> {
  if (rakutenEnabled()) {
    try {
      const items = await searchRakuten(query, tags, budget);
      if (items.length > 0) return await pickFromRakuten(query, tags, budget, items);
    } catch {
      /* 楽天側のエラー → デモにフォールバック */
    }
    return pickFromDemo(query, tags, budget, true);
  }
  return pickFromDemo(query, tags, budget, false);
}

async function handleSearch(body: any) {
  const query = clean(body.query, 300);
  const b = Number(body.budget);
  const budget = Number.isFinite(b) ? Math.round(Math.min(Math.max(b, 100_000), 600_000) / 10_000) * 10_000 : 250_000;
  const tags: string[] = Array.isArray(body.tags)
    ? body.tags.slice(0, 8).map((t: unknown) => clean(t, 20)).filter(Boolean)
    : [];

  const key = `search:${query.toLowerCase().replace(/\s+/g, " ")}|${budget}|${[...tags].sort().join(",")}`;
  const { value, hit } = await cached<SearchResult>(key, SEARCH_TTL, async () => {
    const r = await runSearch(query, tags, budget);
    return { value: r, cache: !r.degraded };
  });
  return { ...value, cached: hit };
}

// ---------------- タブB：自作PC診断 ----------------
async function handleDiagnose(body: any) {
  const p = body.parts || {};
  const parts = {
    cpu: clean(p.cpu, 100), gpu: clean(p.gpu, 100), mb: clean(p.mb, 100),
    ram: clean(p.ram, 100), psu: clean(p.psu, 100), pcCase: clean(p.pcCase, 100),
  };
  if (Object.values(parts).filter(Boolean).length < 3) {
    return { error: "パーツを最低3つは入れてください", status: 400 };
  }

  const key = `diag:${Object.values(parts).map((v) => v.toLowerCase().replace(/\s+/g, " ")).join("|")}`;
  const { value, hit } = await cached(key, DIAG_TTL, async () => {
    const prompt = `あなたは自作PCショップの辛口ベテラン店員です。初心者がやりがちな失敗を、実害ベースで容赦なく指摘してください。
以下のパーツ構成を診断してください。
CPU: ${parts.cpu || "未入力"}
GPU: ${parts.gpu || "未入力"}
マザーボード: ${parts.mb || "未入力"}
メモリ: ${parts.ram || "未入力"}
電源: ${parts.psu || "未入力"}
PCケース: ${parts.pcCase || "未入力"}

チェック観点: ソケット/チップセット/メモリ規格の互換性、BIOS更新が必要になる罠(新CPUに古い在庫マザー等)、GPUの長さ・厚みとケースの干渉、CPUクーラー高さ・ラジエーター対応、電源容量とコネクタ(12V-2x6等)、CPU/GPUのボトルネック、初心者トラップ(前面USB-C、ケースファン不足、保証/OSライセンス等)。
製品名が曖昧・不明な場合は断定せず「要確認」と書くこと。実在しない仕様を作らないこと。

危険度グレード: S=ほぼ問題なし, A=軽微な注意のみ, B=要注意点あり, C=失敗リスク高め, D=このままだと組めない/事故の恐れ。
自作の合計金額(diyTotal)は、日本の現在の相場感でのパーツ合計の概算を円の整数で。
さらに、下のBTOリストから最も近い完成品を1つ選んで equivalentBtoId に入れ、なぜ近いかを btoReason に書くこと。
BTOリスト: ${JSON.stringify(BTO_MODELS.map(slim))}

出力はJSONのみ。形式:
{"grade":"S|A|B|C|D","summary":"総評を2〜3文","warnings":[{"category":"物理干渉|電源|ボトルネック|BIOS|互換性|初心者トラップ","severity":"high|mid|low","title":"短い見出し","detail":"具体的な困りごとと対処法を60〜120字"}],"diyTotal":数値,"equivalentBtoId":"id","btoReason":"60字程度"}
warningsは最大6件、深刻な順。`;

    const ai = await callGemini(prompt);
    const grade = ["S", "A", "B", "C", "D"].includes(ai.grade) ? ai.grade : "C";
    const warnings: Warning[] = (Array.isArray(ai.warnings) ? ai.warnings : [])
      .slice(0, 6)
      .map((w: any) => ({
        category: clean(w?.category, 20) || "その他",
        severity: ["high", "mid", "low"].includes(w?.severity) ? w.severity : "mid",
        title: clean(w?.title, 60),
        detail: clean(w?.detail, 300),
      }));
    const model = BTO_MODELS.find((m) => m.id === ai.equivalentBtoId) || null;
    const total = Number(ai.diyTotal);
    return {
      value: {
        grade, summary: clean(ai.summary, 400), warnings,
        diyTotal: Number.isFinite(total) ? Math.round(total) : 0,
        bto: model ? { model, reason: clean(ai.btoReason, 200) } : null,
      },
      cache: true,
    };
  });
  return { ...value, cached: hit };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "リクエストが多すぎます。1分ほど待ってください。" }, { status: 429 });
  }
  try {
    const body = await req.json();
    if (body.mode === "search") return NextResponse.json(await handleSearch(body));
    if (body.mode === "diagnose") {
      const r: any = await handleDiagnose(body);
      if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NO_KEY") {
      return NextResponse.json({ error: "サーバー側に GEMINI_API_KEY が設定されていません" }, { status: 500 });
    }
    return NextResponse.json({ error: "AIの呼び出しに失敗しました。少し待ってもう一度どうぞ。" }, { status: 502 });
  }
      }
