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

// ── POST /api/summary — Claude AI summary ─────────────────────────────────
app.post("/api/summary", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content?.[0]?.text || "";
    res.json({ text });
  } catch (err) {
    console.error("Anthropic error:", err.message);
    res.status(500).json({ error: "Failed to generate summary" });
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

// ── GET /api/property — Rentcast property lookup ──────────────────────────
app.get("/api/property", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "address is required" });

  try {
    const url = `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}`;
    console.log("[Rentcast] Request URL:", url);
    console.log("[Rentcast] API key present:", !!process.env.RENTCAST_API_KEY);
    const response = await fetch(url, {
      headers: { "X-Api-Key": process.env.RENTCAST_API_KEY },
    });

    const body = await response.text();
    console.log("[Rentcast] Status:", response.status);
    console.log("[Rentcast] Headers:", JSON.stringify(Object.fromEntries(response.headers.entries())));
    console.log("[Rentcast] Body:", body);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Rentcast API error", status: response.status, detail: body });
    }

    const data = JSON.parse(body);
    const prop = Array.isArray(data) ? data[0] : data;
    if (!prop) return res.status(404).json({ error: "Property not found", detail: "Rentcast returned empty result" });

    console.log("[Rentcast] Mapped property:", JSON.stringify(prop, null, 2));

    res.json({
      address: prop.formattedAddress || prop.addressLine1 || address,
      price: prop.price || prop.lastSalePrice || 0,
      beds: prop.bedrooms || 0,
      baths: prop.bathrooms || 0,
      sqft: prop.squareFootage || 0,
      yearBuilt: prop.yearBuilt || 0,
    });
  } catch (err) {
    console.error("[Rentcast] Fetch error:", err.message, err.stack);
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
