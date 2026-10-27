// 每日飲食控管：照片熱量辨識的後端。
// OpenAI 金鑰（OPENAI_API_KEY）和使用密碼（ACCESS_PASSWORD）都設定在 Cloudflare 後台的 Secrets，不寫在程式裡。

const ALLOWED_ORIGINS = ["https://jenz-tseng.github.io"];
const MODEL = "gpt-4o-mini";
const MAX_IMAGE_CHARS = 3_000_000; // data URL 長度上限，約 2 MB 的圖片

// 兩種請求：照片辨識（回傳品項、克數、每 100 公克營養），以及使用者改過品項後的重新計算（純文字）
const PHOTO_PROMPT = `你是台灣的營養師。附上的照片是一餐食物。請辨識照片中每一樣食物，估計實際重量（公克），以及該食物以照片中烹調方式的每 100 公克營養。
若有醬汁、勾芡、油炸，要算進每 100 公克的數值。若照片不是食物，items 回傳空陣列。
只回覆 JSON，格式如下，不要其他文字：
{"items":[{"name":"白飯","grams":160,"kcal100":175,"p100":5,"c100":39,"f100":0.4}],"note":"一句話說明估計的不確定處"}
grams 為公克；kcal100 為每 100 公克大卡；p100/c100/f100 為每 100 公克蛋白質、醣類、脂肪公克數；都是數字。`;
const RECALC_PROMPT = `你是台灣的營養師。以下是使用者確認過的食物名稱，請依台灣常見做法估計每一樣的每 100 公克營養。
只回覆 JSON，items 順序與名稱要和輸入完全相同，不要其他文字：
{"items":[{"name":"白飯","grams":160,"kcal100":175,"p100":5,"c100":39,"f100":0.4}]}
grams 為這個名稱常見一份的重量（名稱若寫了份量如「一碗」「兩顆」就照名稱估）；kcal100 為每 100 公克大卡；p100/c100/f100 為每 100 公克蛋白質、醣類、脂肪公克數；都是數字。
食物：`;

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Password",
    "Vary": "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

// 固定時間比對，避免從回應時間猜出密碼
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method === "GET") return json({ ok: true, configured: !!(env.OPENAI_API_KEY && env.ACCESS_PASSWORD) }, 200, origin);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden_origin" }, 403, origin);
    if (!env.OPENAI_API_KEY || !env.ACCESS_PASSWORD) return json({ error: "not_configured" }, 500, origin);
    if (!same(request.headers.get("X-Access-Password") || "", env.ACCESS_PASSWORD)) {
      return json({ error: "bad_password" }, 401, origin);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400, origin); }
    let content;
    if (Array.isArray(body && body.names)) {
      const names = body.names.slice(0, 20).map(n => String(n).slice(0, 40).trim()).filter(Boolean);
      if (!names.length) return json({ error: "bad_request" }, 400, origin);
      content = [{ type: "text", text: RECALC_PROMPT + JSON.stringify(names) }];
    } else {
      const image = body && body.image;
      if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS) {
        return json({ error: "image_rejected" }, 400, origin);
      }
      const hint = typeof body.hint === "string" ? body.hint.slice(0, 200) : "";
      content = [
        { type: "text", text: PHOTO_PROMPT + (hint ? `\n使用者補充：${hint}` : "") },
        { type: "image_url", image_url: { url: image } },
      ];
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });
    if (!r.ok) return json({ error: r.status === 429 ? "rate_limited" : "upstream_error" }, r.status === 429 ? 429 : 502, origin);

    const data = await r.json();
    try {
      return json(JSON.parse(data.choices[0].message.content), 200, origin);
    } catch {
      return json({ error: "invalid_json" }, 502, origin);
    }
  },
};
