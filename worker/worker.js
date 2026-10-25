// 每日飲食控管：照片熱量辨識的後端。
// OpenAI 金鑰（OPENAI_API_KEY）和使用密碼（ACCESS_PASSWORD）都設定在 Cloudflare 後台的 Secrets，不寫在程式裡。

const ALLOWED_ORIGINS = ["https://jenz-tseng.github.io"];
const MODEL = "gpt-4o-mini";
const MAX_IMAGE_CHARS = 3_000_000; // data URL 長度上限，約 2 MB 的圖片

const PROMPT = `你是台灣的營養師。附上的照片是一餐食物。請辨識照片中每一樣食物，依台灣常見份量估計實際份量、熱量與三大營養素。
若有醬汁、勾芡、油炸，熱量要算進去。若照片不是食物，items 回傳空陣列。
只回覆 JSON，格式如下，不要其他文字：
{"items":[{"name":"白飯","portion":"約1碗(160g)","kcal":280,"p":8,"c":62,"f":0.6}],"note":"一句話說明估計的不確定處"}
kcal 單位大卡，p/c/f 為蛋白質、醣類、脂肪的公克數，都是數字。`;

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
    const image = body && body.image;
    if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS) {
      return json({ error: "image_rejected" }, 400, origin);
    }
    const hint = typeof body.hint === "string" ? body.hint.slice(0, 200) : "";

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PROMPT + (hint ? `\n使用者補充：${hint}` : "") },
            { type: "image_url", image_url: { url: image } },
          ],
        }],
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
