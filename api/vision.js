// Gemini vision proxy — keeps the API key server-side.
// The Frø app points EXPO_PUBLIC_VISION_URL at this endpoint.
// Deploy to Vercel; set GEMINI_API_KEY in the Vercel project environment variables.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }, // images arrive as base64 in the JSON body
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY environment variable is not set");
    return res.status(500).json({ error: "Vision API not configured on server" });
  }

  let lastStatus = 503;
  let lastError = "All models unavailable";

  for (const model of MODELS) {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

    let upstream;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
    } catch (err) {
      lastError = `Network error reaching ${model}: ${err.message}`;
      continue;
    }

    if (upstream.status === 503) {
      lastError = `${model} overloaded`;
      continue;
    }

    // Forward the Gemini response (success or non-503 error) as-is
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  }

  return res.status(lastStatus).json({ error: lastError });
}
