"use client";
import { useState } from "react";
import SearchTab from "@/components/SearchTab";
import DiagnoseTab from "@/components/DiagnoseTab";

export default function Home() {
  const [tab, setTab] = useState<"search" | "diagnose">("search");
  const base = "rounded-xl py-3 text-sm font-bold transition";
  const on = "bg-cyan-400 text-slate-950";
  const off = "bg-slate-800 text-slate-300 active:bg-slate-700";

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.12),transparent_60%)]">
      <main className="mx-auto max-w-3xl px-4 pb-32 pt-6 md:pb-12">
        <header className="mb-4">
          <h1 className="bg-gradient-to-r from-cyan-300 to-fuchsia-400 bg-clip-text text-2xl font-black text-transparent">
            BTO-AI Finder
          </h1>
          <p className="text-xs text-slate-400">ふわっとした要望でBTOを探す ／ 自作PCの落とし穴を辛口診断</p>
        </header>

        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-800 bg-slate-950/90 backdrop-blur md:static md:mb-4 md:border-0 md:bg-transparent md:backdrop-blur-none">
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-2 p-2 md:p-0">
            <button className={`${base} ${tab === "search" ? on : off}`} onClick={() => setTab("search")}>ふわっとBTO検索</button>
            <button className={`${base} ${tab === "diagnose" ? on : off}`} onClick={() => setTab("diagnose")}>自作PC辛口診断</button>
          </div>
        </nav>

        {tab === "search" ? <SearchTab /> : <DiagnoseTab />}

        <footer className="mt-8 space-y-1 text-[11px] leading-relaxed text-slate-500">
          <p>※当サイトはアフィリエイト広告(PR)を含みます。</p>
          <p>※掲載の価格・スペックはデモ用ダミーデータの場合があります。AIの診断は参考情報であり、動作を保証するものではありません。</p>
        </footer>
      </main>
    </div>
  );
}
