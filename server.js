import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

// ── PDF styles ─────────────────────────────────────────────────────────────
const PDF_INK  = "#1e1a0e";
const PDF_CREAM = "#faf5e8";
const PDF_MUTED = "#7a6a44";

const pdfS = StyleSheet.create({
  page:       { padding: 40, backgroundColor: PDF_CREAM, fontFamily: "Helvetica" },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.1)" },
  brand:      { fontSize: 22, fontWeight: "bold", color: PDF_INK },
  tagline:    { fontSize: 7, color: PDF_MUTED, marginTop: 3, letterSpacing: 1.5 },
  badge:      { borderRadius: 4, paddingVertical: 5, paddingHorizontal: 11 },
  badgeLabel: { fontSize: 9, fontWeight: "bold", color: PDF_CREAM, letterSpacing: 0.8 },
  badgePct:   { fontSize: 7, color: "rgba(250,245,232,0.8)", marginTop: 1 },
  address:    { fontSize: 14, fontWeight: "bold", color: PDF_INK, marginBottom: 3 },
  meta:       { fontSize: 9, color: PDF_MUTED, marginBottom: 18 },
  secLabel:   { fontSize: 7, letterSpacing: 1.8, color: PDF_MUTED, textTransform: "uppercase", marginBottom: 7, marginTop: 16 },
  para:       { fontSize: 10, color: PDF_INK, lineHeight: 1.65, marginBottom: 10 },
  paraHead:   { fontSize: 8, fontWeight: "bold", color: PDF_INK, letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 },
  row:        { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  swatch:     { width: 8, height: 8, borderRadius: 2, marginRight: 8 },
  rowLabel:   { fontSize: 9, color: PDF_INK, flex: 1 },
  rowPct:     { fontSize: 9, color: PDF_MUTED, width: 36, textAlign: "right" },
  rowAmt:     { fontSize: 9, fontWeight: "bold", color: PDF_INK, width: 72, textAlign: "right" },
  footer:     { position: "absolute", bottom: 24, left: 40, right: 40, textAlign: "center", fontSize: 7, color: "rgba(0,0,0,0.22)", letterSpacing: 1.5 },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Anthropic client ───────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Build summary prompt from raw property data ────────────────────────────
function buildSummaryPrompt({ address, price, monthlyHousing, income, housingPct, signal, cats, downPct, rate, homeIntent }) {
  const catList = cats.map((c, i) =>
    `${i+1}. ${c.label} (${Number(c.pct).toFixed(0)}% of budget, $${Math.round(c.monthly)}/mo)`
  ).join(", ");

  const homeIntentLine = homeIntent
    ? `\nThe user described what a home means to them: "${homeIntent}". Reference this directly in the summary if it adds emotional weight.\n`
    : "";

  return `You are writing a single-paragraph lifestyle summary for LIVABLE, a home affordability app.
${homeIntentLine}
Property: ${address} — $${Number(price).toLocaleString("en-US")} list price
Monthly housing cost: $${Math.round(monthlyHousing).toLocaleString("en-US")} (${Number(housingPct).toFixed(0)}% of take-home)
Down payment: ${downPct}% | Rate: ${rate}%
Monthly take-home: $${Number(income).toLocaleString("en-US")}
Affordability signal: ${signal?.label || "Unknown"}
Lifestyle priorities in order: ${catList}

Write ONE short paragraph, 40-60 words. Integrate the math, the lifestyle impact, and the verdict in a single direct statement. Reference 1-2 of the user's specific lifestyle priorities by name. Take a clear position — this house fits, doesn't fit, or is a real trade-off worth thinking about. Don't hedge. No section headers. No bullet points. No bold markers. Just a single direct paragraph in the voice of a smart friend who knows finance and tells the truth.`;
}

// ── POST /api/summary — Claude AI summary ─────────────────────────────────
app.post("/api/summary", async (req, res) => {
  console.log("[summary] request received", { address: req.body?.address });

  let prompt;
  try {
    prompt = req.body?.prompt || buildSummaryPrompt(req.body);
  } catch (buildErr) {
    console.warn("[summary] failed to build prompt:", buildErr.message);
    return res.status(400).json({ summary: "", error: "malformed request: " + buildErr.message });
  }

  if (!prompt || prompt.length < 20) {
    console.warn("[summary] missing or malformed request body");
    return res.status(400).json({ summary: "", error: "prompt or property data required" });
  }

  console.log("[summary] prompt built, length:", prompt.length);

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
    console.log("[summary] anthropic responded, content blocks:", message.content?.length);
    const text = message.content?.[0]?.text || "";
    if (!text) console.warn("[summary] anthropic returned empty text");
    res.json({ summary: text, text }); // both keys for compatibility
  } catch (err) {
    console.error("[summary] error:", err.message, err.status || "", err.stack?.split("\n")[1] || "");
    res.status(502).json({ summary: "", text: "", error: err.message });
  }
});

// ── POST /api/suggest-categories — AI lifestyle category suggestions ──────
app.post("/api/suggest-categories", async (req, res) => {
  console.log("[suggest] request received", { intent: req.body?.homeIntent?.slice(0, 60) });
  try {
    const intent = (req.body?.homeIntent || "").trim();
    if (intent.length < 10) return res.status(400).json({ error: "Description too short" });

    const prompt = `A user is buying a home and described what a home means to them: "${intent}"

Based on this description, suggest 3-5 lifestyle spending categories that match the values, activities, or priorities they expressed. Each category should:
- Have a short, specific label (1-2 words, e.g. "Hosting", "Garden", "Recovery", "Kids' activities")
- Have a realistic monthly dollar estimate ($50-$800)
- Reflect what they actually said, not generic categories

Avoid generic labels like "Travel" or "Dining" unless they explicitly mentioned them. Prefer specific labels that come from their language ("Garden" if they mentioned gardening, "Hosting" if they mentioned having people over, etc.).

Respond ONLY with valid JSON in this exact format, no markdown, no preamble:
{"categories":[{"id":"sug_1","label":"Hosting","monthly":150},{"id":"sug_2","label":"Garden","monthly":80}]}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content?.[0]?.text || "";
    console.log("[suggest] raw response:", text.slice(0, 200));

    let parsed;
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[suggest] JSON parse failed:", parseErr.message);
      return res.status(502).json({ error: "AI response was not valid JSON", raw: text });
    }

    if (!Array.isArray(parsed?.categories)) {
      return res.status(502).json({ error: "AI response missing categories array" });
    }

    const categories = parsed.categories
      .filter(c => c?.label && typeof c?.monthly === "number")
      .map((c, i) => ({
        id: c.id || `sug_${Date.now()}_${i}`,
        label: String(c.label).slice(0, 30),
        monthly: Math.max(20, Math.min(2000, Math.round(c.monthly))),
      }))
      .slice(0, 6);

    res.json({ categories });
  } catch (err) {
    console.error("[suggest] error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/pdf — generate PDF report ───────────────────────────────────
app.post("/api/pdf", async (req, res) => {
  const { property, tiles, signal, housingPct, rate, downPct, summary, income } = req.body;
  if (!property || !tiles || !signal) return res.status(400).json({ error: "Missing required fields" });

  const h = React.createElement;
  const paragraphs = summary ? summary.split("\n\n").filter(Boolean) : [];
  const housingMonthly = Math.round((tiles.find(t => t.id === "housing")?.value) || 0);

  const summaryChildren = paragraphs.length > 0 ? [
    h(Text, { key: "sl", style: pdfS.secLabel }, "AI SUMMARY"),
    ...paragraphs.map((p, i) => {
      const m = p.match(/^\*\*(.+?)\*\*\s*[—–-]?\s*([\s\S]*)/);
      return m
        ? h(View, { key: `p${i}`, style: { marginBottom: 10 } },
            h(Text, { style: pdfS.paraHead }, m[1]),
            h(Text, { style: pdfS.para }, m[2])
          )
        : h(Text, { key: `p${i}`, style: pdfS.para }, p.replace(/\*\*/g, ""));
    }),
  ] : [];

  const children = [
    h(View, { style: pdfS.header },
      h(View, null,
        h(Text, { style: pdfS.brand }, "LIVABLE"),
        h(Text, { style: pdfS.tagline }, "HOME · BUDGET · LIFE")
      ),
      h(View, { style: [pdfS.badge, { backgroundColor: signal.color }] },
        h(Text, { style: pdfS.badgeLabel }, signal.label.toUpperCase()),
        h(Text, { style: pdfS.badgePct }, `${Number(housingPct).toFixed(0)}% of income`)
      )
    ),
    h(Text, { style: pdfS.address }, property.address),
    h(Text, { style: pdfS.meta },
      `$${property.price.toLocaleString("en-US")} list price · ${property.beds}bd ${property.baths}ba · $${housingMonthly.toLocaleString("en-US")}/mo est. · ${rate}% · ${downPct}% down`
    ),
    ...summaryChildren,
    h(Text, { style: pdfS.secLabel }, `MONTHLY BREAKDOWN · $${Number(income).toLocaleString("en-US")} TAKE-HOME`),
    ...tiles.map((t, i) =>
      h(View, { key: `t${i}`, style: pdfS.row },
        h(View, { style: [pdfS.swatch, { backgroundColor: t.color }] }),
        h(Text, { style: pdfS.rowLabel }, `${t.label}${t.locked ? " — Fixed" : ""}`),
        h(Text, { style: pdfS.rowPct }, `${((t.value / income) * 100).toFixed(1)}%`),
        h(Text, { style: pdfS.rowAmt }, `$${Math.round(t.value).toLocaleString("en-US")}/mo`)
      )
    ),
    h(Text, { style: pdfS.footer }, "Generated with LIVABLE · livable.app"),
  ];

  try {
    const doc = h(Document, null, h(Page, { size: "A4", style: pdfS.page }, ...children));
    const buffer = await renderToBuffer(doc);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", 'attachment; filename="livable-summary.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error("PDF generation error:", err.message);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ── GET /api/property — Rentcast active listing lookup ────────────────────
app.get("/api/property", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "address is required" });

  const headers = { "X-Api-Key": process.env.RENTCAST_API_KEY };
  const encoded = encodeURIComponent(address);

  try {
    // 1. Try active sale listing — gives current list price
    const listingRes = await fetch(
      `https://api.rentcast.io/v1/listings/sale?address=${encoded}&status=Active&limit=1`,
      { headers }
    );
    console.log("[Rentcast] Listing status:", listingRes.status);

    if (listingRes.ok) {
      const listings = await listingRes.json();
      const listing = Array.isArray(listings) ? listings[0] : null;
      console.log("[Rentcast] Listing result:", JSON.stringify(listing));
      if (listing?.price) {
        return res.json({
          address: listing.formattedAddress || address,
          price: listing.price,
          beds: listing.bedrooms || 0,
          baths: listing.bathrooms || 0,
          sqft: listing.squareFootage || 0,
          yearBuilt: listing.yearBuilt || 0,
        });
      }
    }

    // 2. No active listing found
    return res.status(404).json({
      error: "No active listing found for this address. Try a property that's currently for sale.",
    });
  } catch (err) {
    console.error("[Rentcast] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch property", detail: err.message });
  }
});

// ── GET /api/streetview — proxy Google Street View image ──────────────────
app.get("/api/streetview", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "address is required" });

  const url = `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).send("Street View error");
    res.set("Content-Type", response.headers.get("content-type"));
    res.set("Cache-Control", "public, max-age=86400");
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error("Street View error:", err.message);
    res.status(500).json({ error: "Failed to fetch street view" });
  }
});

// ── Serve Vite build in production ────────────────────────────────────────
app.use(express.static(join(__dirname, "dist")));
app.use((_req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Livable server running on http://localhost:${PORT}`);
});
