const DEFAULT_MODEL = "gemini-flash-latest";
// 混んでいるときは、順番に別のモデルを試す
const MODELS = Array.from(
  new Set([process.env.GEMINI_MODEL || DEFAULT_MODEL, DEFAULT_MODEL, "gemini-flash-lite-latest"])
);
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function callGemini(prompt: string): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("NO_KEY");

  let lastStatus = 0;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
            }),
            signal: AbortSignal.timeout(20_000),
          }
        );
      } catch (e) {
        console.error("GEMINI_ERROR fetch failed", model, String(e));
        lastStatus = 0;
        await sleep(1000);
        continue;
      }

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        try {
          return JSON.parse(text);
        } catch {
          console.error("GEMINI_ERROR json parse", model, text.slice(0, 200));
          break; // 次のモデルへ
        }
      }

      lastStatus = res.status;
      const body = await res.text().catch(() => "");
      console.error("GEMINI_ERROR", res.status, model, body.slice(0, 300));
      if (!RETRY_STATUS.has(res.status)) break; // 404/400/403などは次のモデルへ
      await sleep(1500 * (attempt + 1)); // 混雑系は少し待ってやり直す
    }
  }
  throw new Error(`GEMINI_${lastStatus}`);
}
