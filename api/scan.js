// POST { image: base64string, mimeType: string }
// Returns SeedPacketData JSON parsed from the Gemini response.
// The prompt lives here — callers can only send an image, not arbitrary text.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

const PROMPT = `You are analysing a photograph of a plant label or packet (seeds, bulbs, bare-root, cuttings, etc.).
Extract all growing information that is visible and return it as a single JSON object.
Return ONLY the JSON object — no markdown fences, no explanation.

Fields to extract (omit any field that is not visible or cannot be determined):
{
  "commonName": "e.g. Tomato or Tulip",
  "varietyName": "e.g. Brandywine or Queen of Night",
  "species": "Latin name — infer from common/variety name if not printed",
  "category": "brassica | allium | root | leafy | legume | fruiting | herb | ornamental | fruit | grain",
  "lifecycle": "annual | biennial | perennial",
  "daysToMaturity": 75,

  "germinationDaysMin": 7,
  "germinationDaysMax": 14,
  "sowDepthCm": 0.5,
  "spacingCm": 45,
  "rowSpacingCm": 60,
  "sproutTempMinC": 18,
  "sproutTempMaxC": 24,
  "germinationRatePct": 85,
  "seedViabilityYears": 4,
  "directSow": true,
  "sowWindowIndoorStart": "2000-02-01",
  "sowWindowIndoorEnd": "2000-03-31",
  "sowWindowOutdoorStart": "2000-05-01",
  "sowWindowOutdoorEnd": "2000-06-15",
  "source": "e.g. Baker Creek, Thompson & Morgan",
  "packedForYear": 2025,

  "plantingWindowStart": "2000-09-01",
  "plantingWindowEnd": "2000-11-30",
  "plantingDepthCm": 10,
  "storageTempC": 5,
  "storageLifeDays": 14,
  "establishmentDays": 21,
  "heightMinCm": 30,
  "heightMaxCm": 60,
  "sunExposure": "full_sun | part_sun | shade"
}

Rules:
- All window dates: always use year 2000. Map month names to the 1st of the start month and the last day of the end month.
  Example: "Plant September – November" → plantingWindowStart "2000-09-01", plantingWindowEnd "2000-11-30".
  Example: "Sow indoors March – April" → sowWindowIndoorStart "2000-03-01", sowWindowIndoorEnd "2000-04-30".
- For seed packets: fill the sow window fields. For bulb/corm/tuber/bare-root/cutting packets: fill plantingWindowStart/End instead.
- Temperature: convert to Celsius if given in Fahrenheit (°C = (°F − 32) × 5/9, round to nearest integer).
- Depth and spacing: convert to centimetres if given in inches (1 in = 2.54 cm, round to one decimal).
- plantingDepthCm: planting depth for bulbs, corms, tubers (e.g. "Plant 10 cm deep").
- storageTempC: recommended dormant storage temperature (e.g. "Store at 5°C").
- storageLifeDays: for scions/cuttings, how many days they remain viable after being cut.
- establishmentDays: for cuttings/runners, how many days until rooted/established.
- heightMinCm / heightMaxCm: mature plant height in cm. Convert inches if needed. Use a range when a range is printed; equal values for a single height.
- sunExposure: "full_sun" (6+ hours direct sun), "part_sun" (3–6 hours or dappled), "shade" (<3 hours). Omit if not stated.
- category: use "ornamental" for any plant grown primarily for beauty — trees, shrubs, roses, ornamental grasses, bamboo, bulb flowers, perennial and annual flowers. Use "fruit" only for plants grown to eat the fruit (apple, strawberry, currant). Use "vegetable" for edible crops even when botanically a fruit (tomato, courgette, bean).
- directSow: true if seeds can be sown directly outdoors; false if start indoors only. Omit for non-seed material.
- source: the brand or company name printed on the label.
- packedForYear: if "Sow by", "Best before", "Packed for", or "Use by" year is shown, return as integer. Omit otherwise.`;

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Vision API not configured on server" });

  const { image, mimeType } = req.body ?? {};
  if (!image) return res.status(400).json({ error: "Missing image field" });

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType: mimeType || "image/jpeg", data: image } },
        { text: PROMPT },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  for (const model of MODELS) {
    const upstream = await fetch(
      `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    ).catch(err => { throw new Error(`Network error: ${err.message}`); });

    if (upstream.status === 503) continue;

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => upstream.statusText);
      return res.status(upstream.status).json({ error: `Gemini error ${upstream.status}: ${detail}` });
    }

    const json = await upstream.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) return res.status(502).json({ error: "Empty response from Gemini" });

    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(502).json({ error: "Could not parse Gemini response", raw: text.slice(0, 200) });
    }
  }

  return res.status(503).json({ error: "All models unavailable" });
}
