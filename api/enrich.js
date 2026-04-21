// POST { commonName, varietyName, species?, location? }
// location: { city?, postalCode?, country? }  (country = ISO code e.g. "NO")
// Returns SeedPacketData JSON with growing info tailored to the grower's location.
// The prompt lives here — callers cannot inject arbitrary instructions.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

const COUNTRY_NAMES = {
  NO: "Norway",  SE: "Sweden",      DK: "Denmark",        FI: "Finland",
  DE: "Germany", GB: "United Kingdom", NL: "Netherlands", FR: "France",
  PL: "Poland",  CZ: "Czech Republic", AT: "Austria",     CH: "Switzerland",
  US: "United States", CA: "Canada", AU: "Australia",     NZ: "New Zealand",
};

function buildLocationStr(location) {
  if (!location) return "a temperate Northern European climate";
  const countryName = location.country
    ? (COUNTRY_NAMES[location.country.toUpperCase()] ?? location.country)
    : null;
  return [
    location.city,
    countryName,
    location.postalCode ? `(postal code ${location.postalCode})` : null,
  ].filter(Boolean).join(", ") || "a temperate Northern European climate";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Enrich API not configured on server" });

  const { commonName, varietyName, species, location } = req.body ?? {};
  if (!commonName || !varietyName) {
    return res.status(400).json({ error: "Missing commonName or varietyName" });
  }

  const locationStr = buildLocationStr(location);

  const prompt =
    `You are a gardening knowledge base. For the plant variety described below, provide typical growing information tailored to the grower's local climate.\n\n` +
    `Plant: ${commonName}\n` +
    `Variety: ${varietyName}\n` +
    (species ? `Species: ${species}\n` : "") +
    `Grower location: ${locationStr}\n\n` +
    `Return ONLY a JSON object — no markdown, no explanation. Use this schema (omit fields you are not confident about):\n` +
    `{\n` +
    `  "commonName": "...",\n` +
    `  "varietyName": "...",\n` +
    `  "species": "Latin name",\n` +
    `  "category": "vegetable|herb|ornamental|fruit|grain",\n` +
    `  "lifecycle": "annual|biennial|perennial",\n` +
    `  "daysToMaturity": 75,\n` +
    `  "germinationDaysMin": 7,\n` +
    `  "germinationDaysMax": 14,\n` +
    `  "sowDepthCm": 0.5,\n` +
    `  "spacingCm": 45,\n` +
    `  "rowSpacingCm": 60,\n` +
    `  "sproutTempMinC": 18,\n` +
    `  "sproutTempMaxC": 24,\n` +
    `  "seedViabilityYears": 4,\n` +
    `  "directSow": false,\n` +
    `  "sowWindowIndoorStart": "2000-03-01",\n` +
    `  "sowWindowIndoorEnd": "2000-04-30",\n` +
    `  "sowWindowOutdoorStart": "2000-05-01",\n` +
    `  "sowWindowOutdoorEnd": "2000-06-15"\n` +
    `}\n\n` +
    `Rules:\n` +
    `- All window dates: always use year 2000. Adjust sow windows for the grower's latitude and last frost date.\n` +
    `- For Norwegian locations: assume last frost late May in the south, mid-June in the north.\n` +
    `- Only include fields you are confident about for this specific variety.\n` +
    `- commonName and varietyName: return them normalised (e.g. title case variety names).`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
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
