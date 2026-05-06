import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import React from "react";
import { Document, Page, View, Text, Svg, Rect, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

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

// ── Property context helpers ───────────────────────────────────────────────
function describePropertyType(propertyType) {
  if (!propertyType) return null;
  const t = propertyType.toLowerCase();
  if (t.includes("single family")) return "single-family house";
  if (t.includes("condo"))         return "condo";
  if (t.includes("town"))          return "townhouse";
  if (t.includes("duplex") || t.includes("multi")) return "multi-unit building";
  if (t.includes("manufactured") || t.includes("mobile")) return "manufactured home";
  return propertyType.toLowerCase();
}

function describeLot(lotSize, propertyType) {
  if (!lotSize || propertyType?.toLowerCase().includes("condo")) return null;
  if (lotSize < 2000)  return "very small lot";
  if (lotSize < 4000)  return "small lot";
  if (lotSize < 7500)  return "modest yard";
  if (lotSize < 12000) return "decent yard";
  if (lotSize < 22000) return "large yard";
  return "very large lot, almost half an acre or more";
}

function describeAge(yearBuilt) {
  if (!yearBuilt || yearBuilt < 1800) return null;
  const age = new Date().getFullYear() - yearBuilt;
  if (age < 5)   return "newly built";
  if (age < 20)  return "relatively recent construction";
  if (age < 40)  return "mid-aged home";
  if (age < 70)  return "older home, mid-century era";
  if (age < 100) return "older home, pre-war era";
  return "very old, historic-era home";
}

function describeMarketTime(daysOnMarket) {
  if (daysOnMarket == null) return null;
  if (daysOnMarket < 7)   return "fresh listing, just hit the market";
  if (daysOnMarket < 21)  return "moving — under three weeks on the market";
  if (daysOnMarket < 60)  return "been on the market a few weeks";
  if (daysOnMarket < 120) return "been on the market a while, may signal pricing or condition issues";
  return "been on the market a long time, likely pricing or condition issues";
}

function buildPropertyContext(property) {
  const parts = [];
  const type = describePropertyType(property.propertyType);
  if (type) parts.push(type);
  const age = describeAge(property.yearBuilt);
  if (age) parts.push(age);
  const lot = describeLot(property.lotSize, property.propertyType);
  if (lot) parts.push(lot);
  if (property.beds && property.baths) parts.push(`${property.beds} bed, ${property.baths} bath`);
  if (property.sqft) parts.push(`${Number(property.sqft).toLocaleString("en-US")} sqft`);
  const market = describeMarketTime(property.daysOnMarket);
  if (market) parts.push(market);
  if (property.city && property.state) parts.push(`in ${property.city}, ${property.state}`);
  return parts.join(" · ") || "details not available";
}

// ── Build summary prompt — three-dimensional cross-examination ─────────────
function buildSummaryPrompt({ property, monthlyHousing, income, essentialsTotal, housingPct, verdict, signal, cats, downPct, rate }) {
  const recurring     = (cats || []).filter(c => c.kind === "recurring");
  const savings       = (cats || []).filter(c => c.kind === "savings");
  const propertyNeeds = (cats || []).filter(c => c.kind === "property");
  const oneTime       = (cats || []).filter(c => c.kind === "one_time");

  const recurringStr  = recurring.length
    ? recurring.map(c => `${c.label}: $${Math.round(c.monthly)}/mo`).join("; ")
    : "none specified";
  const savingsStr    = savings.length
    ? savings.map(c => `${c.label}: saving $${Math.round(c.monthly)}/mo`).join("; ")
    : "none specified";
  const propertyStr   = propertyNeeds.length
    ? propertyNeeds.map(c => `${c.label} — needs ${c.propertyNeed}`).join("; ")
    : "none specified";
  const oneTimeStr    = oneTime.length
    ? oneTime.map(c => c.label).join(", ")
    : "none specified";

  const propertyContext = buildPropertyContext(property);

  return `You are writing a single-paragraph home advisor summary for LIVABLE, an app that tells people whether a specific home fits the life they've actually described.

PROPERTY:
${property.address}
List price: $${Number(property.price).toLocaleString("en-US")}
Monthly housing cost: $${Math.round(monthlyHousing).toLocaleString("en-US")} at ${rate}% with ${downPct}% down
Property profile: ${propertyContext}

USER'S FINANCIAL REALITY:
Monthly take-home: $${Number(income).toLocaleString("en-US")}
Monthly essentials (savings, healthcare, education, groceries, utilities, transport): $${Math.round(essentialsTotal || 0).toLocaleString("en-US")}
This house takes ${Number(housingPct).toFixed(0)}% of their take-home pay.
Verdict: ${verdict?.label || signal?.label || "Unknown"} (financial fit ${verdict?.financial ?? "??"}/100, lifestyle fit ${verdict?.lifestyle ?? "??"}/100, property fit ${verdict?.property ?? "??"}/100).

USER'S LIFESTYLE COMMITMENTS, BY KIND:
Monthly recurring spending: ${recurringStr}
Monthly savings goals: ${savingsStr}
One-time things they care about (no real monthly cost): ${oneTimeStr}
Property requirements (things the HOUSE itself must support): ${propertyStr}

YOUR TASK:
Write ONE direct paragraph, 60-90 words, that does genuine cross-examination across three dimensions:
1. FINANCIAL FIT — does the math work? Reference 1-2 specific dollar amounts from their commitments where they're most affected.
2. LIFESTYLE FIT — does this house leave room for what they actually do every month?
3. PROPERTY FIT — does this house have what they said the home itself needs to support? You have property attributes (lot size, type, age, location). Use them. If a property requirement matches what the house likely offers, say so. If it conflicts, say so. If you genuinely can't tell from available data, acknowledge that briefly rather than guessing.

RULES:
- Take a clear position. Fits, doesn't fit, or a real trade-off — say which.
- Reference specific things by name (a specific commitment label, a specific property attribute).
- Don't invent numbers. Only use values provided.
- Don't pad. If only two of the three dimensions are interesting for this property, focus there.
- No section headers. No bullet points. No bold markers. One direct paragraph, plain prose.
- Voice: smart friend who knows finance and home-buying, tells the truth, doesn't hedge.`;
}

// ── Port of client-side computeRects for PDF treemap ──────────────────────
function computeRects(tiles, W, H, gap) {
  if (!tiles.length) return [];
  const total = tiles.reduce((s, t) => s + t.value, 0);
  const housing = tiles.find(t => t.id === "housing");
  if (!housing) return [];
  const rest = tiles.filter(t => t.id !== "housing");
  const leftW = (housing.value / total) * (W - gap);
  const rightW = W - leftW - gap;
  const rightX = leftW + gap;
  const rects = [{ id: "housing", x: 0, y: 0, w: leftW, h: H }];
  if (!rest.length) return rects;
  const ROW_SIZE = 3;
  const rows = [];
  for (let i = 0; i < rest.length; i += ROW_SIZE) rows.push(rest.slice(i, i + ROW_SIZE));
  const rowTotals = rows.map(r => r.reduce((s, t) => s + t.value, 0));
  const grandTotal = rowTotals.reduce((s, v) => s + v, 0);
  let ry = 0;
  rows.forEach((row, ri) => {
    const rowH = (rowTotals[ri] / grandTotal) * (H - (rows.length - 1) * gap);
    let rx = rightX;
    row.forEach((tile, ti) => {
      const w = ti === row.length - 1
        ? (rightX + rightW) - rx
        : (tile.value / rowTotals[ri]) * (rightW - (row.length - 1) * gap);
      rects.push({ id: tile.id, x: rx, y: ry, w, h: rowH });
      rx += w + gap;
    });
    ry += rowH + gap;
  });
  return rects;
}

// ── POST /api/summary — Claude AI summary ─────────────────────────────────
app.post("/api/summary", async (req, res) => {
  const body = req.body || {};
  // Normalize: new clients send { property: {...}, monthlyHousing, ... }
  // Old clients send flat { address, price, monthlyHousing, ... }
  const payload = body.property
    ? body
    : {
        ...body,
        property: {
          address: body.address,
          price: body.price,
          beds: body.beds,
          baths: body.baths,
          sqft: body.sqft,
          yearBuilt: body.yearBuilt,
        },
      };
  console.log("[summary] request received", { address: payload.property?.address });

  let prompt;
  try {
    prompt = body.prompt || buildSummaryPrompt(payload);
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
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
    console.log("[summary] anthropic responded, content blocks:", message.content?.length);
    const text = message.content?.[0]?.text || "";
    if (!text) console.warn("[summary] anthropic returned empty text");
    res.json({ summary: text, text });
  } catch (err) {
    console.error("[summary] error:", err.message, err.status || "", err.stack?.split("\n")[1] || "");
    res.status(502).json({ summary: "", text: "", error: err.message });
  }
});

// ── POST /api/pdf — generate PDF report ───────────────────────────────────
app.post("/api/pdf", async (req, res) => {
  const { property, tiles, verdict, signal, housingPct, rate, downPct, summary, income } = req.body;
  if (!property || !tiles || !(verdict || signal)) return res.status(400).json({ error: "Missing required fields" });
  const displayVerdict = verdict || { label: signal?.label || "Unknown", color: signal?.color || "#4A9B6F" };

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

  // Treemap SVG for PDF
  const MAP_W = 480, MAP_H = 280, MAP_GAP = 3;
  const mapTiles = tiles.filter(t => t.value > 0);
  const mapRects = computeRects(mapTiles, MAP_W, MAP_H, MAP_GAP);
  const treemapSvg = h(View, { style: { marginBottom: 14 } },
    h(Svg, { width: MAP_W, height: MAP_H, viewBox: `0 0 ${MAP_W} ${MAP_H}` },
      ...mapRects.map(rect => {
        const tile = mapTiles.find(t => t.id === rect.id);
        if (!tile) return null;
        const pct = (tile.value / income) * 100;
        const pad = 6;
        const pctSize = Math.max(10, Math.min(28, Math.min(rect.w / 3.5, rect.h / 3.5)));
        const labelSize = Math.max(6, Math.min(10, rect.w / 8));
        const children = [h(Rect, { key: `r_${rect.id}`, x: rect.x, y: rect.y, width: rect.w, height: rect.h, fill: tile.color, rx: 4 })];
        if (rect.w > 30) {
          children.push(
            h(Text, { key: `l_${rect.id}`, x: rect.x + pad, y: rect.y + pad + labelSize, fontSize: labelSize, fill: PDF_CREAM, fontFamily: "Helvetica" },
              tile.label.toUpperCase()
            ),
            h(Text, { key: `p_${rect.id}`, x: rect.x + pad, y: rect.y + pad + labelSize + 4 + pctSize, fontSize: pctSize, fill: PDF_CREAM, fontFamily: "Helvetica-Bold" },
              `${pct.toFixed(0)}%`
            )
          );
        }
        return children;
      }).filter(Boolean).flat()
    )
  );

  const children = [
    h(View, { style: pdfS.header },
      h(View, null,
        h(Text, { style: pdfS.brand }, "LIVABLE"),
        h(Text, { style: pdfS.tagline }, "MAKE YOUR DREAM HOME DOABLE")
      ),
      h(View, { style: [pdfS.badge, { backgroundColor: displayVerdict.color }] },
        h(Text, { style: pdfS.badgeLabel }, displayVerdict.label.toUpperCase()),
        h(Text, { style: pdfS.badgePct }, `${Number(housingPct).toFixed(0)}% of income`)
      )
    ),
    h(Text, { style: pdfS.address }, property.address),
    h(Text, { style: pdfS.meta },
      [
        `$${property.price.toLocaleString("en-US")} list price`,
        (property.beds || property.baths) ? `${property.beds || 0}bd ${property.baths || 0}ba` : null,
        `$${housingMonthly.toLocaleString("en-US")}/mo est.`,
        `${rate}%`,
        `${downPct}% down`,
      ].filter(Boolean).join(" · ")
    ),
    treemapSvg,
    ...summaryChildren,
    h(Text, { style: pdfS.secLabel }, `MONTHLY BREAKDOWN · $${Number(income).toLocaleString("en-US")} TAKE-HOME`),
    ...tiles.filter(t => t.value > 0).map((t, i) =>
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
        const result = {
          address: listing.formattedAddress || address,
          price: listing.price,
          beds: listing.bedrooms || 0,
          baths: listing.bathrooms || 0,
          sqft: listing.squareFootage || 0,
          yearBuilt: listing.yearBuilt || 0,
        };
        if (listing.lotSize)           result.lotSize       = listing.lotSize;
        if (listing.propertyType)      result.propertyType  = listing.propertyType;
        if (listing.daysOnMarket != null) result.daysOnMarket = listing.daysOnMarket;
        if (listing.listedDate)        result.listedDate    = listing.listedDate;
        if (listing.county)            result.county        = listing.county;
        if (listing.city)              result.city          = listing.city;
        if (listing.state)             result.state         = listing.state;
        if (listing.zipCode)           result.zipCode       = listing.zipCode;
        if (listing.latitude != null)  result.latitude      = listing.latitude;
        if (listing.longitude != null) result.longitude     = listing.longitude;
        return res.json(result);
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
