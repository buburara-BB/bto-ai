"use client";
import { useState } from "react";
import type { DiagnoseResult, PartsInput } from "@/lib/types";
import { amazonSearchUrl, rakutenSearchUrl } from "@/lib/affiliate";

const FIELDS: { key: keyof PartsInput; label: string; presets: string[] }[] = [
  { key: "cpu", label: "CPU", presets: ["Ryzen 7 9800X3D", "Ryzen 5 7500F", "Core i7-14700K", "Core i5-14400F"] },
  { key: "gpu", label: "GPU", presets: ["RTX 5070 Ti", "RTX 5070", "RTX 5060 Ti 16GB", "RTX 4070 SUPER"] },
  { key: "mb", label: "マザーボード", presets: ["B650 ATX", "B650M mATX", "B760M mATX", "Z790 ATX"] },
  { key: "ram", label: "メモリ", presets: ["DDR5 32GB (16GBx2)", "DDR5 16GB (8GBx2)", "DDR4 16GB"] },
  { key: "psu", label: "電源", presets: ["650W 80PLUS Bronze", "750W 80PLUS Gold", "850W 80PLUS Gold ATX3.1"] },
  { key: "pcCase", label: "PCケース", presets: ["ミニタワー mATXケース", "ミドルタワー ATXケース", "コンパクト Mini-ITXケース"] },
];

const SAMPLE_BAD: PartsInput = {
  cpu: "Ryzen 7 9800X3D", gpu: "RTX 5070 Ti", mb: "B650M mATX (在庫の古いロット)",
  ram: "DDR5 32GB (16GBx2)", psu: "650W 80PLUS Bronze", pcCase: "コンパクト ミニタワー mATXケース",
};
const SAMPLE_OK: PartsInput = {
  cpu: "Ryzen 5 7500F", gpu: "RTX 5060 Ti 16GB", mb: "B650 ATX",
  ram: "DDR5 32GB (16GBx2)", psu: "750W 80PLUS Gold", pcCase: "ミドルタワー ATXケース",
};

const GRADE_STYLE: Record<string, string> = {
  S: "from-emerald-400 to-cyan-400", A: "from-lime-400 to-emerald-400",
  B: "from-yellow-300 to-amber-400", C: "from-orange-400 to-red-400", D: "from-red-500 to-rose-700",
};
const SEV_STYLE: Record<string, string> = {
  high: "border-rose-500/60 bg-rose-500/10",
  mid: "border-amber-400/60 bg-amber-400/10",
  low: "border-slate-600 bg-slate-800/50",
};
const SEV_LABEL: Record<string, string> = { high: "危険", mid: "注意", low: "軽微" };

export default function DiagnoseTab() {
  const [parts, setParts] = useState<PartsInput>({ cpu: "", gpu: "", mb: "", ram: "", psu: "", pcCase: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DiagnoseResult | null>(null);

  async function submit() {
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "diagnose", parts }),
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

  const diff = result?.bto ? result.diyTotal - result.bto.model.price : 0;

  return (
    <section className="space-y-5">
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex gap-2 text-xs">
          <button onClick={() => setParts(SAMPLE_BAD)} className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300 active:bg-slate-800">例：地雷っぽい構成</button>
          <button onClick={() => setParts(SAMPLE_OK)} className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300 active:bg-slate-800">例：無難な構成</button>
        </div>

        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="text-sm font-semibold text-cyan-300">{f.label}</label>
            <input
              list={`dl-${f.key}`}
              value={parts[f.key]}
              maxLength={100}
              onChange={(e) => setParts({ ...parts, [f.key]: e.target.value })}
              placeholder="自由記述 or 候補から選択"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-base outline-none focus:border-cyan-400"
            />
            <datalist id={`dl-${f.key}`}>
              {f.presets.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>
        ))}

        <button onClick={submit} disabled={loading}
          className="w-full rounded-xl bg-gradient-to-r from-rose-500 to-fuchsia-500 py-4 text-base font-bold text-white shadow-lg shadow-rose-500/20 disabled:opacity-60">
          {loading ? "辛口チェック中…" : "AIに辛口診断させる"}
        </button>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>

      {result && (
        <div className="space-y-5">
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-4">
              <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${GRADE_STYLE[result.grade]} text-5xl font-black text-slate-950`}>
                {result.grade}
              </div>
              <div>
                <p className="text-xs text-slate-500">S=安心 ／ D=かなり危険</p>
                <p className="text-sm leading-relaxed text-slate-200">{result.summary}</p>
              </div>
            </div>
            <div className="space-y-2">
              {result.warnings.map((w, i) => (
                <div key={i} className={`rounded-xl border p-3 ${SEV_STYLE[w.severity]}`}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded bg-slate-950 px-2 py-0.5 text-slate-300">{w.category}</span>
                    <span className="font-bold">{SEV_LABEL[w.severity]}</span>
                  </div>
                  <p className="mt-1 font-bold">{w.title}</p>
                  <p className="text-sm text-slate-300">{w.detail}</p>
                </div>
              ))}
              {result.warnings.length === 0 && <p className="text-sm text-slate-400">大きな警告はありませんでした。</p>}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <h3 className="font-bold text-cyan-300">パーツを探す</h3>
            {FIELDS.filter((f) => parts[f.key].trim()).map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate"><span className="text-slate-500">{f.label}：</span>{parts[f.key]}</span>
                <span className="flex shrink-0 gap-2">
                  <a href={amazonSearchUrl(parts[f.key])} target="_blank" rel="sponsored noopener noreferrer" className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950">Amazon</a>
                  <a href={rakutenSearchUrl(parts[f.key])} target="_blank" rel="sponsored noopener noreferrer" className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white">楽天</a>
                </span>
              </div>
            ))}
          </div>

          {result.bto && (
            <div className="space-y-3 rounded-2xl border-2 border-fuchsia-500/70 bg-gradient-to-br from-fuchsia-950/60 to-slate-900 p-4">
              <p className="text-xs font-bold tracking-widest text-fuchsia-300">逆転提案</p>
              <p className="text-sm leading-relaxed">
                自作の合計目安 <b className="text-lg">¥{result.diyTotal.toLocaleString()}</b> に対し、ほぼ同スペックの完成品BTO(保証付き)なら
                {" "}<b className="text-lg text-fuchsia-300">¥{result.bto.model.price.toLocaleString()}</b> で買えます！
              </p>
              <div className="grid grid-cols-2 gap-2 text-center text-sm">
                <div className="rounded-xl bg-slate-950 p-3">
                  <p className="text-xs text-slate-500">自作(概算)</p>
                  <p className="font-bold">¥{result.diyTotal.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">保証はパーツごと</p>
                </div>
                <div className="rounded-xl bg-slate-950 p-3">
                  <p className="text-xs text-slate-500">完成品BTO</p>
                  <p className="font-bold text-fuchsia-300">¥{result.bto.model.price.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">組立・動作確認済み</p>
                </div>
              </div>
              <p className="text-sm text-slate-300">
                {diff > 0
                  ? `BTOのほうが約¥${diff.toLocaleString()}安い計算です。`
                  : diff < 0
                  ? `金額だけなら自作が約¥${Math.abs(diff).toLocaleString()}安いけど、組む手間と失敗リスクは自己責任です。`
                  : "ほぼ同額です。"}
              </p>
              <p className="text-sm text-slate-300">
                <b>{result.bto.model.maker} {result.bto.model.name}</b>
                <span className="text-slate-500">（{result.bto.model.cpu} / {result.bto.model.gpu} / {result.bto.model.ram}）</span><br />
                {result.bto.reason}
              </p>
              <a href={result.bto.model.url} target="_blank" rel="sponsored noopener noreferrer"
                className="block rounded-xl bg-fuchsia-500 py-3 text-center font-bold text-white">
                このBTOを公式サイトで見る →
              </a>
              <p className="text-[11px] text-slate-500">※金額はAIの概算とダミーデータです。購入前に必ず最新価格を確認してください。</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
              }
