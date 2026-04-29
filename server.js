import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

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
