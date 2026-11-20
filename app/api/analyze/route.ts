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
予算上限: ${budget}円(これが最終の予算。要望文に金額があっても、この値に合わせて判断すること) / 用途タグ: ${tags.join(", ") || "指定なし"} / 要望: ${query || "指定なし"}
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
  const sliderBudget = Number.isFinite(b)
    ? Math.round(Math.min(Math.max(b, 100_000), 600_000) / 10_000) * 10_000
    : 250_000;

  // 文章中に「15万円」のような金額があれば、スライダーより文章を優先する(10〜60万円の範囲のみ)
  let budget = sliderBudget;
  let budgetNote = "";
  const m = query.match(/(\d+(?:\.\d+)?)\s*万/);
  if (m) {
    const man = Number(m[1]);
    if (man >= 10 && man <= 60) {
      const typed = Math.round(man) * 10_000;
      if (typed !== sliderBudget) {
        budgetNote = `文章に書かれた予算(${typed / 10_000}万円)を優先しました。`;
      }
      budget = typed;
    }
  }

  const tags: string[] = Array.isArray(body.tags)
    ? body.tags.slice(0, 8).map((t: unknown) => clean(t, 20)).filter(Boolean)
    : [];

  const key = `search:${query.toLowerCase().replace(/\s+/g, " ")}|${budget}|${[...tags].sort().join(",")}`;
  const { value, hit } = await cached<SearchResult>(key, SEARCH_TTL, async () => {
    const r = await runSearch(query, tags, budget);
    return { value: r, cache: !r.degraded };
  });
  const note = [budgetNote, value.note].filter(Boolean).join(" ") || undefined;
  return { ...value, note, cached: hit };
}

// ---------------- タブB：自作PC診断 ----------------
// 「型番が存在しない」系の断定を検出する(AIの知識より新しい製品を誤判定しやすいため)
const NONEXIST = /実在しない|存在しない|架空|無効な型番|誤った型番|型番.{0,6}(誤り|間違|無効)/;

async function handleDiagnose(body: any) {
  const p = body.parts || {};
  const parts = {
    cpu: clean(p.cpu, 100), gpu: clean(p.gpu, 100), mb: clean(p.mb, 100),
    ram: clean(p.ram, 100), psu: clean(p.psu, 100), pcCase: clean(p.pcCase, 100),
  };
  if (Object.values(parts).filter(Boolean).length < 3) {
    return { error: "パーツを最低3つは入れてください", status: 400 };
  }

  const key = `diag4:${Object.values(parts).map((v) => v.toLowerCase().replace(/\s+/g, " ")).join("|")}`;
  const { value, hit } = await cached(key, DIAG_TTL, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const prompt = `あなたは自作PCショップのベテラン店員です。口調は辛口でかまいませんが、内容は「正確さ」を最優先してください。初心者がやりがちな失敗を、実害ベースで指摘します。
今日は ${today} です。あなたの知識より新しい製品が、すでに発売されている可能性があります。
以下のパーツ構成を診断してください。
CPU: ${parts.cpu || "未入力"}
GPU: ${parts.gpu || "未入力"}
マザーボード: ${parts.mb || "未入力"}
メモリ: ${parts.ram || "未入力"}
電源: ${parts.psu || "未入力"}
PCケース: ${parts.pcCase || "未入力"}

【絶対ルール】
1. 事実と推測を分ける。各警告の detail の先頭に、確実に言えることは【確実】、型番や仕様が曖昧・不明で断定できないことは【要確認】を必ず付ける。
2. 「火を吹く」「確実に壊れる」「絶対に動かない」など、不安を煽る誇張表現は禁止。具体的な理由と対処を淡々と書く。
3. 【型番の実在判定の禁止】入力された型番について「実在しない」「存在しない」「架空」「無効」と判断・記載してはいけない。自分の知識にない型番は、新製品の可能性があるため「知識にない型番のため、仕様をメーカー公式で要確認」とだけ書き、その製品の仕様(ソケット・消費電力など)を推測で断定しない。
4. 【確実】を付けてよいのは、次のような規格上の判定だけ: ソケットの不一致、メモリ世代(DDR4/DDR5)の不一致、ケースの対応サイズ超過。製品の実在や、細かい仕様は【確実】にしない。
5. 規格の判定は次に従う。
・ケースの対応サイズ: ATXケース(ミドルタワー等)=ATX/mATX/Mini-ITX対応。mATXケース(ミニタワー等)=mATX/Mini-ITX対応。Mini-ITXケース=Mini-ITXのみ。マザーボードのサイズがケースの対応サイズ以内なら「不一致」ではないので、その警告は出さない。
・マザーボードのサイズ判定: 名前に「M」が付く型番(例 B650M、B760M)や「mATX」表記はmATX。「ITX」表記はMini-ITX。「ATX」表記や、それ以外の通常型番(例 Z790、B650)はATX。
・新しいCPUと古いロットのマザーボードの組み合わせは「BIOS更新が必要な場合がある」止まりにし、起動不可と断定しない(【要確認】)。
6. 電源は、GPUメーカーの推奨電源容量(分かる場合)と比べて「余裕が少ない」「不足の恐れ」と書く。推奨値が分からない場合は【要確認】とする。
7. GPUの長さ・厚みとケースの干渉、CPUクーラー高さなどは、具体的な寸法が分からない限り【要確認】とする。

【未入力の項目がある場合のルール】
・「未入力」のパーツを、入っている前提で診断してはいけない。
・上の6項目(CPU・GPU・マザーボード・メモリ・電源・PCケース)のうち、未入力が1つでもあれば、入力済みのパーツから導ける推奨スペックを、1件の警告にまとめて含めること(category は「未入力の補完」、severity は low か mid、detail の先頭は【要確認】)。
・例: 電源が未入力なら、GPUとCPUから「◯W以上(余裕を見て◯W前後)、80PLUS Gold以上がおすすめ」。ケースが未入力なら、マザーボードの規格に対応し、GPUの長さが収まるサイズ。メモリが未入力なら、マザーボードに合うDDR世代と容量の目安。
・推奨は「目安」と明記し、具体的な製品名は挙げず、スペックの範囲で書く。
・入力欄は上の6項目(CPU・GPU・マザーボード・メモリ・電源・PCケース)だけです。ストレージ、CPUクーラー、ケースファン、OSなど、入力欄にないパーツを「未入力」と書いてはいけない。
・ただし初心者が忘れがちなので、入力欄にないパーツ(ストレージ・CPUクーラーなど)は、警告を1件にまとめて、category は「初心者トラップ」、severity は low、detail の先頭は【要確認】にして、「入力欄にないが別途必要。CPUに純正クーラーが付属するかは型番で変わる」といった短い注意を書くこと。

【危険度の付け方】
severity: high=【確実】な非互換、物理的に入らない、電源が明らかに足りない場合だけ。mid=余裕が少ない、BIOS更新が必要な可能性、干渉の恐れ。low=補足や提案。【要確認】の警告は high にしない。
グレード: S=ほぼ問題なし, A=軽微な注意のみ, B=要注意点あり, C=失敗リスクが高い(【確実】な問題が1つ以上、または要確認が多い), D=【確実】な非互換や起動不能が1つ以上ある場合だけ。入力済みの範囲だけで判定すること。

自作の合計金額(diyTotal)は、日本の現在の相場感でのパーツ合計の概算を円の整数で。未入力パーツや知らない型番は、近い製品の相場で概算すること。
さらに、下のBTOリストから最も近い完成品を1つ選んで equivalentBtoId に入れ、なぜ近いかを btoReason に書くこと。
BTOリスト: ${JSON.stringify(BTO_MODELS.map(slim))}

出力はJSONのみ。形式:
{"grade":"S|A|B|C|D","summary":"総評を2〜3文。誇張せず、確実な点と要確認の点を分けて書く","warnings":[{"category":"物理干渉|電源|ボトルネック|BIOS|互換性|初心者トラップ|未入力の補完","severity":"high|mid|low","title":"短い見出し","detail":"【確実】または【要確認】で始め、具体的な困りごとと対処法を60〜120字"}],"diyTotal":数値,"equivalentBtoId":"id","btoReason":"60字程度"}
warningsは最大6件、深刻な順。ただし「未入力の補完」は、該当する場合は必ず1件含めること。`;

    const ai = await callGemini(prompt);

    // 安全装置1: 「型番が存在しない」系の断定は、強制的に「要確認」に書き換える
    let replacedNonexist = false;
    const warnings: Warning[] = [];
    for (const w of (Array.isArray(ai.warnings) ? ai.warnings : []).slice(0, 6)) {
      let title = clean(w?.title, 60);
      let detail = clean(w?.detail, 300);
      let severity: "high" | "mid" | "low" = ["high", "mid", "low"].includes(w?.severity)
        ? w.severity
        : "mid";
      if (NONEXIST.test(`${title} ${detail}`)) {
        if (replacedNonexist) continue; // 同じ趣旨の警告は1件にまとめる
        replacedNonexist = true;
        title = "型番の確認";
        detail =
          "【要確認】入力された型番の一部が、AIの知識にない新製品の可能性があります。メーカー公式サイトで型番と仕様(対応ソケット・消費電力など)を確認してください。";
        severity = "low";
      } else if (severity === "high" && !detail.startsWith("【確実】")) {
        // 安全装置2: 【確実】が付いていない「危険」は「注意」に下げる
        severity = "mid";
      }
      warnings.push({ category: clean(w?.category, 20) || "その他", severity, title, detail });
    }

    let summary = clean(ai.summary, 400);
    if (NONEXIST.test(summary)) {
      summary =
        "入力された型番の一部がAIの知識になく、断定できない点があります。各警告の【確実】と【要確認】を分けて確認してください。";
    }

    // 安全装置3: 確実な危険が1つもないのに判定がDなら、Cに下げる
    let grade = ["S", "A", "B", "C", "D"].includes(ai.grade) ? ai.grade : "C";
    if (grade === "D" && !warnings.some((w) => w.severity === "high")) grade = "C";

    const model = BTO_MODELS.find((m) => m.id === ai.equivalentBtoId) || null;
    const total = Number(ai.diyTotal);
    return {
      value: {
        grade, summary, warnings,
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
