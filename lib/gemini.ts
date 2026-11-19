const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function callGemini(prompt: string): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("NO_KEY");
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );
  } catch (e) {
    console.error("GEMINI_ERROR fetch failed", MODEL, String(e));
    throw e;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("GEMINI_ERROR", res.status, MODEL, body.slice(0, 400));
    throw new Error(`GEMINI_${res.status}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("GEMINI_ERROR json parse", MODEL, text.slice(0, 200));
    throw e;
  }
}
