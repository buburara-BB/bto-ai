"use client";
import { useState } from "react";
import type { SearchResult } from "@/lib/types";

const TAGS = ["FPS", "配信", "モンハン", "動画編集", "AI/生成", "静音", "白モデル", "コスパ", "ゲーム全般"];
const EXAMPLES = [
  "モンハンワイルズを快適に遊べる25万円以下の白いPC",
  "予算20万でApexと配信が快適なPC",
  "RTX4070とRyzen7搭載でコスパ最強のやつ",
];

export default function SearchTab() {
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState(25);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);

  const toggle = (t: string) =>
    setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  async function submit() {
    if (!query.trim() && tags.length === 0) {
      setError("要望かタグ、どっちかは入れてください");
      return;
    }
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "search", query, budget: budget * 10000, tags }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "エラーが発生しました");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <label className="block text-sm font-semibold text-cyan-300">どんなPCがほしい？</label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="例：モンハンワイルズを快適に遊べる25万円以下の白いPC"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-base outline-none focus:border-cyan-400"
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setQuery(ex)}
              className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 active:bg-slate-800">
              {ex}
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-cyan-300">予算上限</span>
            <span className="text-2xl font-bold">{budget}<span className="text-sm text-slate-400"> 万円</span></span>
          </div>
          <input type="range" min={10} max={60} step={1} value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="mt-2 h-8 w-full accent-cyan-400" />
        </div>

        <div>
          <span className="text-sm font-semibold text-cyan-300">用途</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {TAGS.map((t) => (
              <button key={t} onClick={() => toggle(t)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  tags.includes(t)
                    ? "border-cyan-400 bg-cyan-400/20 text-cyan-200"
                    : "border-slate-700 text-slate-300 active:bg-slate-800"
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <button onClick={submit} disabled={loading}
          className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-4 text-base font-bold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-60">
          {loading ? "AIが探してます…" : "AIに最適解を探させる"}
        </button>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4">
          {result.note && <p className="text-sm text-slate-400">{result.note}</p>}
          {result.picks.map((m, i) => (
            <article key={`${m.name}-${i}`} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400 text-sm font-black text-slate-950">{i + 1}</span>
                <span className="truncate rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{m.maker}</span>
              </div>
              <div className="flex gap-3">
                {m.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.image} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-lg bg-white object-contain" />
                )}
                <h3 className="text-base font-bold leading-snug">{m.name}</h3>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">CPU</dt><dd>{m.cpu}</dd>
                <dt className="text-slate-500">GPU</dt><dd>{m.gpu}</dd>
                <dt className="text-slate-500">メモリ</dt><dd>{m.ram}</dd>
                <dt className="text-slate-500">ストレージ</dt><dd>{m.storage}</dd>
              </dl>
              <p className="text-2xl font-black text-fuchsia-300">¥{m.price.toLocaleString()}<span className="text-xs font-normal text-slate-500">(税込目安)</span></p>
              <p className="rounded-xl bg-slate-950 p-3 text-sm leading-relaxed text-slate-300">
                <span className="mr-1 font-bold text-cyan-300">AIの理由：</span>{m.reason}
              </p>
              <a href={m.url} target="_blank" rel="sponsored noopener noreferrer"
                className="block rounded-xl border border-cyan-400 py-3 text-center font-bold text-cyan-300 active:bg-cyan-400/10">
                {m.source === "rakuten" ? "楽天市場で詳細を見る →" : "公式サイトで詳細を見る →"}
              </a>
            </article>
          ))}
          {result.source === "rakuten" && (
            <p className="text-[11px] leading-relaxed text-slate-500">
              価格・在庫は取得時点(最大6時間前)の情報です。購入前に必ずリンク先で最新情報をご確認ください。<br />
              Supported by Rakuten Developers
            </p>
          )}
        </div>
      )}
    </section>
  );
}
