import { useState, useRef, useCallback, useEffect } from "react";

// ── localStorage helpers ───────────────────────────────────────────────────
const STORAGE_KEY = "livable:profile:v1";

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.income || !parsed?.essentials) return null;
    delete parsed.homeIntent;
    if (Array.isArray(parsed.cats)) {
      parsed.cats = parsed.cats.map(c => {
        if (typeof c === "string") {
          const def = CATS.find(d => d.id === c);
          return { id: c, label: def?.label || c, kind: "recurring", monthly: 0, custom: false, propertyNeed: null };
        }
        const def = CATS.find(d => d.id === c.id);
        return {
          id: c.id,
          label: c.label || def?.label || c.id,
          custom: c.custom ?? false,
          kind: c.kind || "recurring",
          monthly: typeof c.monthly === "number" ? c.monthly : 0,
          propertyNeed: c.propertyNeed || null,
        };
      });
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {}
}

function clearProfile() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ── Brand ──────────────────────────────────────────────────────────────────
const BG       = "#cdd4b0";
const CREAM    = "#faf5e8";
const INK      = "#1e1a0e";
const MUTED    = "#7a6a44";
const HOUSING_COLOR = "#C8412A";
const NEEDS_COLOR   = "#5a4e8a";
const CAT_COLORS    = ["#3B7FC4","#4A9B6F","#E8A030","#D4505A","#3A9EA5","#C4963B","#7B5EA7","#D97B3A"];

const MOBILE_MAX = 430;

function darkenHex(hex, amt = 30) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - amt);
  const g = Math.max(0, ((n >> 8) & 0xff) - amt);
  const b = Math.max(0, (n & 0xff) - amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function catKindSublabel(cat) {
  if (!cat) return "";
  if (cat.kind === "savings") return `saving $${Math.round(cat.monthly || 0).toLocaleString("en-US")}/mo`;
  if (cat.kind === "one_time") return "one-time cost";
  if (cat.kind === "property") return cat.propertyNeed ? `needs ${cat.propertyNeed}` : "property need";
  return `$${Math.round(cat.monthly || 0).toLocaleString("en-US")}/mo`;
}

// ── Mortgage math ──────────────────────────────────────────────────────────
function monthlyPayment(price, downPct, annualRate) {
  const principal = price * (1 - downPct / 100);
  const r = annualRate / 100 / 12;
  const n = 360;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}
function pmiMonthly(price, downPct) {
  if (downPct >= 20) return 0;
  return Math.round(price * 0.0085 / 12);
}

// ── Multi-dimensional verdict ──────────────────────────────────────────────
const PROPERTY_NEED_KEYWORDS = {
  yard:     ["yard", "garden", "outdoor", "lawn", "landscap", "grass"],
  garage:   ["garage", "parking", "car", "vehicles", "workshop"],
  office:   ["office", "study", "den", "workspace", "work from home", "wfh"],
  basement: ["basement", "storage", "cellar", "utility"],
  pool:     ["pool", "swim"],
  pets:     ["pet", "dog", "cat", "animal", "fence", "fenced"],
  space:    ["space", "room", "large", "big", "open floor", "entertaining"],
};

function scoreFinancial(housingPct, tiles, profile) {
  let base;
  if      (housingPct <= 20) base = 100;
  else if (housingPct <= 28) base = Math.round(100 - ((housingPct - 20) / 8)  * 15);
  else if (housingPct <= 35) base = Math.round(85  - ((housingPct - 28) / 7)  * 20);
  else if (housingPct <= 45) base = Math.round(65  - ((housingPct - 35) / 10) * 25);
  else                       base = Math.max(0, Math.round(40 - ((housingPct - 45) / 25) * 40));

  const inc        = profile.income;
  const totalSpend = tiles.reduce((s, t) => s + t.value, 0);
  const surplus    = ((inc - totalSpend) / inc) * 100;
  const sAdj       = surplus > 10 ? 5 : surplus > 0 ? 0 : surplus > -10 ? -8 : -18;

  return Math.max(0, Math.min(100, base + sAdj));
}

function scoreLifestyle(tiles, profile) {
  const inc          = profile.income;
  const lifePct      = (tiles.filter(t => t.id !== "housing" && t.id !== "needs")
                             .reduce((s, t) => s + t.value, 0) / inc) * 100;
  let base;
  if      (lifePct >= 18) base = 90;
  else if (lifePct >= 12) base = Math.round(90 - ((18 - lifePct) / 6)  * 25);
  else if (lifePct >= 6)  base = Math.round(65 - ((12 - lifePct) / 6)  * 30);
  else if (lifePct >= 2)  base = Math.round(35 - ((6  - lifePct) / 4)  * 25);
  else                    base = 10;
  return Math.max(0, Math.min(100, base));
}

function matchPropertyNeed(needText, property) {
  if (!needText || !property) return 50;
  const lower = needText.toLowerCase();
  const lot   = property.lotSize || 0;
  const type  = (property.propertyType || "").toLowerCase();
  const beds  = property.beds || 0;
  const sqft  = property.sqft || 0;
  let signals = 0, matches = 0;
  if (PROPERTY_NEED_KEYWORDS.yard.some(k => lower.includes(k)))
    { signals++; if (lot >= 4000 && !type.includes("condo")) matches++; }
  if (PROPERTY_NEED_KEYWORDS.garage.some(k => lower.includes(k)))
    { signals++; if (!type.includes("condo") && !type.includes("apartment")) matches++; }
  if (PROPERTY_NEED_KEYWORDS.office.some(k => lower.includes(k)))
    { signals++; if (beds >= 3) matches++; }
  if (PROPERTY_NEED_KEYWORDS.basement.some(k => lower.includes(k)))
    { signals++; }
  if (PROPERTY_NEED_KEYWORDS.pool.some(k => lower.includes(k)))
    { signals++; }
  if (PROPERTY_NEED_KEYWORDS.pets.some(k => lower.includes(k)))
    { signals++; if (lot >= 2000 && !type.includes("condo")) matches++; }
  if (PROPERTY_NEED_KEYWORDS.space.some(k => lower.includes(k)))
    { signals++; if (beds >= 3 || sqft >= 1800) matches++; }
  return signals ? Math.round((matches / signals) * 100) : 50;
}

function scoreProperty(property, profile) {
  const needs = (profile?.cats || []).filter(c => c.kind === "property" && c.propertyNeed);
  if (!needs.length) return 75;
  return Math.round(needs.reduce((s, c) => s + matchPropertyNeed(c.propertyNeed, property), 0) / needs.length);
}

function integrateVerdict({ financial, lifestyle, property }) {
  return Math.round(financial * 0.45 + lifestyle * 0.30 + property * 0.25);
}

function computeVerdict({ tiles, profile, property, housingPct }) {
  if (!tiles.length) return { label: "–", color: INK, headline: "–", subline: "–", score: 0, financial: 0, lifestyle: 0, property: 0 };
  const financial     = scoreFinancial(housingPct, tiles, profile);
  const lifestyle     = scoreLifestyle(tiles, profile);
  const propertyScore = scoreProperty(property, profile);
  const score         = integrateVerdict({ financial, lifestyle, property: propertyScore });

  const housingVal      = tiles.find(t => t.id === "housing")?.value || 0;
  const lifestyleBudget = Math.max(profile.income - housingVal - profile.essentialsTotal, 0);
  const lbStr           = `$${Math.round(lifestyleBudget).toLocaleString("en-US")}`;

  let label, color, headline, subline;
  if (score >= 80) {
    label = "Fits Your Life";    color = "#4A9B6F";
    headline = "This home works.";
    subline  = "Healthy lifestyle budget — room for what matters to you.";
  } else if (score >= 65) {
    label = "Mostly Fits";       color = "#6FA876";
    headline = "Close, with trade-offs.";
    subline  = "Healthy lifestyle budget — room for what matters to you.";
  } else if (score >= 50) {
    label = "Real Trade-Off";    color = "#E8A030";
    headline = "Something gives.";
    subline  = "Tight on lifestyle — your priorities and the math will compete.";
  } else if (score >= 35) {
    label = "Stretched";         color = "#D97B3A";
    headline = "Stretched thin.";
    subline  = `At ${housingPct.toFixed(0)}% housing, only ${lbStr}/mo left for how you want to live.`;
  } else {
    label = "Works Against You"; color = "#C8412A";
    headline = "Hard to make work.";
    subline  = `At ${housingPct.toFixed(0)}% housing, only ${lbStr}/mo left for how you want to live.`;
  }
  return { label, color, headline, subline, score, financial, lifestyle, property: propertyScore };
}

// ── Treemap layout ─────────────────────────────────────────────────────────
function computeRects(tiles, W, H, gap) {
  if (!tiles.length) return [];
  const g = gap;
  const total = tiles.reduce((s, t) => s + t.value, 0);
  const housing = tiles.find(t => t.id === "housing");
  if (!housing) return [];
  const rest = tiles.filter(t => t.id !== "housing");
  const leftW = (housing.value / total) * (W - g);
  const rightW = W - leftW - g;
  const rightX = leftW + g;
  const rects = [{ id: "housing", x: 0, y: 0, w: leftW, h: H }];
  if (!rest.length) return rects;
  const ROW_SIZE = 3;
  const rows = [];
  for (let i = 0; i < rest.length; i += ROW_SIZE) rows.push(rest.slice(i, i + ROW_SIZE));
  const rowTotals = rows.map(r => r.reduce((s, t) => s + t.value, 0));
  const grandTotal = rowTotals.reduce((s, v) => s + v, 0);
  let ry = 0;
  rows.forEach((row, ri) => {
    const rowH = (rowTotals[ri] / grandTotal) * (H - (rows.length - 1) * g);
    let rx = rightX;
    row.forEach((tile, ti) => {
      const w = ti === row.length - 1
        ? (rightX + rightW) - rx
        : (tile.value / rowTotals[ri]) * (rightW - (row.length - 1) * g);
      rects.push({ id: tile.id, x: rx, y: ry, w, h: rowH });
      rx += w + g;
    });
    ry += rowH + g;
  });
  return rects;
}

// Full-width row layout for lifestyle band (no housing-left pin)
function computeBandRects(tiles, W, H, gap) {
  if (!tiles.length) return [];
  const total = tiles.reduce((s, t) => s + t.value, 0);
  if (total === 0) return [];
  const ROW_SIZE = 3;
  const rows = [];
  for (let i = 0; i < tiles.length; i += ROW_SIZE) rows.push(tiles.slice(i, i + ROW_SIZE));
  const rowTotals = rows.map(r => r.reduce((s, t) => s + t.value, 0));
  const grandTotal = rowTotals.reduce((s, v) => s + v, 0);
  const rects = [];
  let ry = 0;
  rows.forEach((row, ri) => {
    const rowH = Math.max(0, (rowTotals[ri] / grandTotal) * (H - (rows.length - 1) * gap));
    let rx = 0;
    row.forEach((tile, ti) => {
      const w = ti === row.length - 1
        ? W - rx
        : (tile.value / rowTotals[ri]) * (W - (row.length - 1) * gap);
      rects.push({ id: tile.id, x: rx, y: ry, w: Math.max(0, w), h: rowH });
      rx += Math.max(0, w) + gap;
    });
    ry += rowH + gap;
  });
  return rects;
}

// ── Category options ───────────────────────────────────────────────────────
const CATS = [
  { id: "travel",        label: "Travel",        shortLabel: "Trvl" },
  { id: "dining",        label: "Dining",        shortLabel: "Din"  },
  { id: "hobbies",       label: "Hobbies",       shortLabel: "Hob"  },
  { id: "social",        label: "Social",        shortLabel: "Soc"  },
  { id: "subscriptions", label: "Subscriptions", shortLabel: "Subs" },
  { id: "pets",          label: "Pets",          shortLabel: "Pets" },
  { id: "fitness",       label: "Fitness",       shortLabel: "Fit"  },
  { id: "style",         label: "Style",         shortLabel: "Style"},
  { id: "giving",        label: "Giving",        shortLabel: "Give" },
];

// ── Essentials line-item fields ────────────────────────────────────────────
const ESSENTIAL_FIELDS = [
  { id: "savings",    label: "Savings",         placeholder: "500" },
  { id: "healthcare", label: "Healthcare",      placeholder: "300" },
  { id: "education",  label: "Education",       placeholder: "0"   },
  { id: "groceries",  label: "Groceries",       placeholder: "600" },
  { id: "transport",  label: "Gas / Transport", placeholder: "200" },
  { id: "utilities",  label: "Utilities",       placeholder: "180" },
];

// ── Property fetch via backend (Rentcast API) ──────────────────────────────
async function fetchProperty(address) {
  const res = await fetch(`/api/property?address=${encodeURIComponent(address)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch property");
  }
  return await res.json();
}

// ── Freddie Mac mock rate (swap for real fetch) ────────────────────────────
const CURRENT_RATE = 6.82;

// ── AI Summary via backend (Claude API) ────────────────────────────────────
async function generateSummary(data) {
  try {
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    console.log("[summary] HTTP status:", res.status);
    const json = await res.json();
    console.log("[summary] response body:", json);
    const text = json.summary || json.text || "";
    if (!text && json.error) console.error("[summary] server error:", json.error);
    return text;
  } catch (e) {
    console.error("[summary] fetch failed:", e);
    return "";
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SCREENS
// ══════════════════════════════════════════════════════════════════════════

// ── Shared styles ──────────────────────────────────────────────────────────
const font = "'Futura','Century Gothic','Trebuchet MS',sans-serif";
const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "rgba(255,255,255,0.5)",
  border: "1.5px solid rgba(100,90,60,0.22)",
  borderRadius: 4, padding: "9px 11px",
  fontSize: 16, color: INK, fontFamily: font, outline: "none",
};
const btnPrimary = (disabled) => ({
  background: disabled ? "#b0aa90" : INK,
  color: CREAM, border: "none",
  padding: "13px 28px", fontSize: 10, letterSpacing: "0.2em",
  textTransform: "uppercase", cursor: disabled ? "default" : "pointer",
  borderRadius: 3, fontFamily: font, fontWeight: "700", width: "100%",
});

// ── Screen: Welcome (cold-start) ──────────────────────────────────────────
function WelcomeScreen({ onContinue }) {
  return (
    <div style={{
      height: "100%",
      background: BG,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      padding: "40px 24px",
      boxSizing: "border-box",
    }}>
      <div style={{ width: "100%", maxWidth: MOBILE_MAX, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontSize: 28, fontWeight: "800", color: INK, letterSpacing: "-0.01em", marginBottom: 4 }}>
          LIVABLE
        </div>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 72 }}>
          HOME · BUDGET · LIFE
        </div>
        <div style={{ fontSize: 32, fontWeight: "800", color: INK, letterSpacing: "-0.02em", lineHeight: 1.1, textAlign: "center", marginBottom: 16 }}>
          Make your dream<br />home doable.
        </div>
        <div style={{ fontSize: 11, color: MUTED, letterSpacing: "0.04em", textAlign: "center", lineHeight: 1.5, marginBottom: 56 }}>
          Where you want to live · what you need to live · how you want to live.
        </div>
        <button
          onClick={onContinue}
          style={{ ...btnPrimary(false), width: "auto", padding: "14px 36px", fontSize: 11, letterSpacing: "0.12em" }}
        >
          Tell us about your life →
        </button>
        <div style={{ marginTop: 12, fontSize: 10, color: MUTED, letterSpacing: "0.04em" }}>
          Takes about two minutes
        </div>
      </div>
    </div>
  );
}

// ── Screen: Onboarding ────────────────────────────────────────────────────
function OnboardingScreen({ onDone }) {
  const [income, setIncome]         = useState("");
  const [essentials, setEssentials] = useState({});
  const [downPct, setDownPct]       = useState("10");
  const [selectedCats, setSelected]        = useState([]);
  const [pendingCategory, setPendingCat]   = useState(null); // { id, label } | null
  const [pendingKind, setPendingKind]      = useState(null);
  const [pendingAmount, setPendingAmt]     = useState("");
  const [pendingPropertyNeed, setPendingPN] = useState("");
  const [customKind, setCustomKind]        = useState(null); // null=hidden, "label", "selecting", or kind
  const [customLabel, setCustomLabel]      = useState("");
  const [customAmount, setCustomAmount]    = useState("");
  const [customPropertyNeed, setCustomPN]  = useState("");
  const MAX_CATS = 5;

  const cancelPending = () => { setPendingCat(null); setPendingKind(null); setPendingAmt(""); setPendingPN(""); };

  const toggleCat = (id) => {
    const existingIdx = selectedCats.findIndex(c => c.id === id);
    if (existingIdx >= 0) { setSelected(prev => prev.filter((_, i) => i !== existingIdx)); return; }
    if (selectedCats.length >= MAX_CATS) return;
    const def = CATS.find(c => c.id === id);
    setPendingCat({ id, label: def?.label || id });
    setPendingKind(null); setPendingAmt(""); setPendingPN("");
  };

  const selectKind = (kind) => {
    if (kind === "one_time") {
      setSelected(prev => [...prev, { id: pendingCategory.id, label: pendingCategory.label, custom: false, kind: "one_time", monthly: null, propertyNeed: null }]);
      cancelPending(); return;
    }
    setPendingKind(kind);
  };

  const confirmPendingPick = () => {
    if (!pendingCategory || !pendingKind) return;
    const cat = {
      id: pendingCategory.id, label: pendingCategory.label, custom: false, kind: pendingKind,
      monthly: (pendingKind === "recurring" || pendingKind === "savings") ? (parseFloat(pendingAmount) || 0) : null,
      propertyNeed: pendingKind === "property" ? (pendingPropertyNeed.trim() || null) : null,
    };
    setSelected(prev => [...prev, cat]);
    cancelPending();
  };

  const essentialsTotal = Object.values(essentials).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const canProceed = income && essentialsTotal > 0 && selectedCats.length >= 1;

  return (
    <div style={{
      height: "100%", overflowY: "auto", overscrollBehavior: "contain",
      paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
      paddingLeft: 14, paddingRight: 14,
      boxSizing: "border-box",
    }}>
    <div style={{ width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto" }}>
      {/* Wordmark */}
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 26, fontWeight: "800", color: INK, letterSpacing: "-0.03em" }}>LIVABLE</div>
      </div>

      {/* Free tier notice */}
      <div style={{
        background: "rgba(255,255,255,0.4)", border: `1px solid rgba(100,90,60,0.16)`,
        borderRadius: 5, padding: "7px 10px", marginBottom: 14,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ fontSize: 9, fontWeight: "700", color: INK, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          3 free looks included
        </div>
        <div style={{ fontSize: 9, color: MUTED }}>$4.99/mo for unlimited</div>
      </div>

      {/* Income */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
          Monthly take-home pay
        </div>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13 }}>$</span>
          <input style={{ ...inputStyle, paddingLeft: 24 }} placeholder="e.g. 7500" value={income} onChange={e => setIncome(e.target.value)} type="number" inputMode="numeric" />
        </div>
      </div>

      {/* Essentials breakdown — 2-col grid */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
          Monthly essentials
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {ESSENTIAL_FIELDS.map(f => (
            <div key={f.id}>
              <div style={{ fontSize: 9, letterSpacing: "0.14em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
                {f.label}
              </div>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 14 }}>$</span>
                <input
                  style={{ ...inputStyle, padding: "9px 11px 9px 22px" }}
                  placeholder={f.placeholder}
                  value={essentials[f.id] || ""}
                  onChange={e => setEssentials(prev => ({ ...prev, [f.id]: e.target.value }))}
                  type="number"
                  inputMode="numeric"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Down payment */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
          Down payment — {downPct}%
          {parseFloat(downPct) < 20 && <span style={{ color: "#D97B3A", marginLeft: 6 }}>PMI applies</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["5","10","15","20","25","30"].map(p => (
            <div
              key={p}
              onClick={() => setDownPct(p)}
              style={{
                flex: 1, textAlign: "center", padding: "7px 0",
                background: downPct === p ? INK : "rgba(255,255,255,0.45)",
                border: `1.5px solid ${downPct === p ? INK : "rgba(100,90,60,0.2)"}`,
                borderRadius: 4, fontSize: 10, fontWeight: "600",
                color: downPct === p ? CREAM : INK,
                cursor: "pointer", fontFamily: font,
                transition: "all 0.12s",
              }}
            >
              {p}%
            </div>
          ))}
        </div>
      </div>

      {/* Lifestyle priorities */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, fontWeight: "700", color: INK, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 2 }}>
          Top lifestyle priorities
        </div>
        <div style={{ fontSize: 8, color: MUTED, marginBottom: 6 }}>
          Tap in order. First tap = most important. Up to {MAX_CATS}.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {CATS.map((cat) => {
            const rank = selectedCats.findIndex(c => c.id === cat.id);
            const selected = rank !== -1;
            const isPending = pendingCategory?.id === cat.id;
            const atLimit = selectedCats.length >= MAX_CATS && !selected;
            return (
              <div
                key={cat.id}
                onClick={() => !isPending && toggleCat(cat.id)}
                style={{
                  background: isPending ? `${CAT_COLORS[0]}18` : selected ? `${CAT_COLORS[rank % CAT_COLORS.length]}22` : "rgba(255,255,255,0.38)",
                  border: `1.5px solid ${isPending ? CAT_COLORS[0] : selected ? CAT_COLORS[rank % CAT_COLORS.length] : "rgba(100,90,60,0.18)"}`,
                  borderRadius: 6, padding: "10px 6px",
                  cursor: atLimit ? "default" : "pointer",
                  opacity: atLimit ? 0.38 : 1,
                  textAlign: "center", position: "relative",
                  transition: "all 0.12s",
                }}
              >
                <div style={{ fontSize: 10, fontWeight: "700", color: INK, letterSpacing: "0.05em", textTransform: "uppercase" }}>{cat.label}</div>
                {selected && (
                  <>
                    <div style={{
                      position: "absolute", top: -6, right: -6,
                      width: 18, height: 18, borderRadius: "50%",
                      background: CAT_COLORS[rank % CAT_COLORS.length],
                      color: CREAM, fontSize: 9, fontWeight: "800",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                    }}>
                      {rank + 1}
                    </div>
                    <div style={{ fontSize: 8, color: CAT_COLORS[rank % CAT_COLORS.length], marginTop: 2, opacity: 0.85 }}>
                      {catKindSublabel(selectedCats[rank])}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Pending category — 3-stage kind flow */}
        {pendingCategory && (
          <div style={{ marginTop: 10, padding: 12, background: "rgba(255,255,255,0.6)", borderRadius: 6, border: "1.5px solid rgba(100,90,60,0.2)" }}>
            <div style={{ fontSize: 9, color: MUTED, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
              {pendingCategory.label} — how does it show up in your life?
            </div>
            {pendingKind === null ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { kind: "recurring", label: "Recurring monthly", sub: "Coffee, gym, dining out..." },
                  { kind: "savings",   label: "Saving toward it",  sub: "Vacation fund, gear savings..." },
                  { kind: "one_time",  label: "One-time cost",     sub: "Gear purchase, trip, event..." },
                  { kind: "property",  label: "Property requirement", sub: "Yard, garage, extra room..." },
                ].map(({ kind, label, sub }) => (
                  <div key={kind} onClick={() => selectKind(kind)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: "rgba(255,255,255,0.5)", border: "1.5px solid rgba(100,90,60,0.2)", borderRadius: 5, cursor: "pointer" }}>
                    <div style={{ fontSize: 10, fontWeight: "700", color: INK }}>{label}</div>
                    <div style={{ fontSize: 8, color: MUTED }}>{sub}</div>
                  </div>
                ))}
                <button onClick={cancelPending} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>Cancel</button>
              </div>
            ) : pendingKind === "property" ? (
              <>
                <div style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>What does {pendingCategory.label} need from the home?</div>
                <input
                  autoFocus
                  placeholder="e.g. large yard, garage, extra bedroom..."
                  value={pendingPropertyNeed}
                  onChange={e => setPendingPN(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && pendingPropertyNeed.trim()) confirmPendingPick(); if (e.key === "Escape") cancelPending(); }}
                  style={{ ...inputStyle, fontSize: 16, marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={confirmPendingPick} disabled={!pendingPropertyNeed.trim()} style={{ ...btnPrimary(!pendingPropertyNeed.trim()), padding: "8px 14px", fontSize: 9 }}>Add</button>
                  <button onClick={cancelPending} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>{pendingKind === "savings" ? "How much are you saving per month?" : "Monthly budget?"}</div>
                <div style={{ position: "relative", marginBottom: 8 }}>
                  <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED }}>$</span>
                  <input
                    autoFocus
                    placeholder="e.g. 200"
                    value={pendingAmount}
                    onChange={e => setPendingAmt(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") confirmPendingPick(); if (e.key === "Escape") cancelPending(); }}
                    type="number" inputMode="numeric"
                    style={{ ...inputStyle, paddingLeft: 22, fontSize: 16 }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={confirmPendingPick} disabled={!pendingAmount} style={{ ...btnPrimary(!pendingAmount), padding: "8px 14px", fontSize: 9 }}>Add</button>
                  <button onClick={cancelPending} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Custom category chips */}
        {selectedCats.filter(c => c.custom).length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap" }}>
            {selectedCats.filter(c => c.custom).map(c => {
              const rank = selectedCats.findIndex(s => s.id === c.id);
              return (
                <div key={c.id} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 10px", marginRight: 6, marginBottom: 6,
                  background: `${CAT_COLORS[rank % CAT_COLORS.length]}22`,
                  border: `1.5px solid ${CAT_COLORS[rank % CAT_COLORS.length]}`,
                  borderRadius: 14, fontSize: 11, fontWeight: "700",
                  color: CAT_COLORS[rank % CAT_COLORS.length],
                }}>
                  {rank + 1} {c.label} · {catKindSublabel(c)}
                  <span onClick={() => setSelected(prev => prev.filter(s => s.id !== c.id))} style={{ cursor: "pointer", marginLeft: 4, opacity: 0.6 }}>×</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Add your own — staged flow */}
        {selectedCats.length < MAX_CATS && customKind === null && (
          <div
            onClick={() => setCustomKind("label")}
            style={{
              marginTop: 8, padding: "10px 6px",
              background: "rgba(255,255,255,0.38)",
              border: "1.5px dashed rgba(100,90,60,0.35)",
              borderRadius: 6, textAlign: "center", cursor: "pointer",
              fontSize: 10, fontWeight: "700", color: MUTED,
              letterSpacing: "0.05em", textTransform: "uppercase",
            }}
          >
            + Add your own
          </div>
        )}
        {customKind !== null && (
          <div style={{ marginTop: 10, padding: 10, background: "rgba(255,255,255,0.5)", borderRadius: 6 }}>
            {customKind === "label" ? (
              <>
                <input
                  autoFocus
                  placeholder="e.g. Kids' activities"
                  value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && customLabel.trim()) setCustomKind("selecting"); if (e.key === "Escape") { setCustomKind(null); setCustomLabel(""); } }}
                  style={{ ...inputStyle, fontSize: 16, marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { if (customLabel.trim()) setCustomKind("selecting"); }} disabled={!customLabel.trim()} style={{ ...btnPrimary(!customLabel.trim()), padding: "8px 14px", fontSize: 9 }}>Next →</button>
                  <button onClick={() => { setCustomKind(null); setCustomLabel(""); }} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>Cancel</button>
                </div>
              </>
            ) : customKind === "selecting" ? (
              <>
                <div style={{ fontSize: 9, color: MUTED, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>{customLabel} — what kind?</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { kind: "recurring", label: "Recurring monthly" },
                    { kind: "savings",   label: "Saving toward it" },
                    { kind: "one_time",  label: "One-time cost" },
                    { kind: "property",  label: "Property requirement" },
                  ].map(({ kind, label }) => (
                    <div key={kind} onClick={() => {
                      if (kind === "one_time") {
                        const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: "one_time", monthly: null, propertyNeed: null };
                        setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                        setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN(""); return;
                      }
                      setCustomKind(kind);
                    }} style={{ padding: "9px 12px", background: "rgba(255,255,255,0.5)", border: "1.5px solid rgba(100,90,60,0.2)", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: "700", color: INK }}>
                      {label}
                    </div>
                  ))}
                  <button onClick={() => { setCustomKind("label"); setCustomAmount(""); setCustomPN(""); }} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>← Back</button>
                </div>
              </>
            ) : customKind === "property" ? (
              <>
                <div style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>What does {customLabel} need from the home?</div>
                <input
                  autoFocus
                  placeholder="e.g. large yard, extra bedroom..."
                  value={customPropertyNeed}
                  onChange={e => setCustomPN(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && customPropertyNeed.trim()) {
                      const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: "property", monthly: null, propertyNeed: customPropertyNeed.trim() };
                      setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                      setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN("");
                    }
                    if (e.key === "Escape") setCustomKind("selecting");
                  }}
                  style={{ ...inputStyle, fontSize: 16, marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    if (!customPropertyNeed.trim()) return;
                    const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: "property", monthly: null, propertyNeed: customPropertyNeed.trim() };
                    setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                    setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN("");
                  }} disabled={!customPropertyNeed.trim()} style={{ ...btnPrimary(!customPropertyNeed.trim()), padding: "8px 14px", fontSize: 9 }}>Add</button>
                  <button onClick={() => setCustomKind("selecting")} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>← Back</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>{customKind === "savings" ? "Saving per month?" : "Monthly budget?"}</div>
                <div style={{ position: "relative", marginBottom: 8 }}>
                  <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED }}>$</span>
                  <input
                    autoFocus
                    placeholder="350"
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && customAmount) {
                        const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: customKind, monthly: parseFloat(customAmount) || 0, propertyNeed: null };
                        setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                        setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN("");
                      }
                      if (e.key === "Escape") setCustomKind("selecting");
                    }}
                    type="number" inputMode="numeric"
                    style={{ ...inputStyle, paddingLeft: 22, fontSize: 16 }}
                  />
            </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    if (!customAmount) return;
                    const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: customKind, monthly: parseFloat(customAmount) || 0, propertyNeed: null };
                    setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                    setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN("");
                  }} disabled={!customAmount} style={{ ...btnPrimary(!customAmount), padding: "8px 14px", fontSize: 9 }}>Add</button>
                  <button onClick={() => setCustomKind("selecting")} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>← Back</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <button
        style={btnPrimary(!canProceed)}
        onClick={() => canProceed && onDone({
          income: parseFloat(income),
          essentialsTotal,
          essentials,
          downPct: parseFloat(downPct),
          cats: selectedCats,
        })}
      >
        Start Using Livable →
      </button>
    </div>
    </div>
  );
}

// ── Screen: Address Entry ─────────────────────────────────────────────────
function AddressScreen({ usesLeft, onSearch, onEditProfile }) {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const handleGo = async () => {
    if (!address.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const prop = await fetchProperty(address);
      onSearch(prop);
    } catch (err) {
      setError(err.message || "Property not found. Check the address and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto",
      height: "100%",
      overflow: "hidden",
      position: "relative",
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      {/* Avatar — floats top-right */}
      <div
        onClick={onEditProfile}
        style={{
          position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 14px)", right: 16,
          width: 40, height: 40, borderRadius: "50%",
          background: "rgba(255,255,255,0.45)",
          border: "1.5px solid rgba(100,90,60,0.22)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", zIndex: 10,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
        </svg>
        {usesLeft === 0 && (
          <div style={{
            position: "absolute", top: -2, right: -2,
            width: 16, height: 16, borderRadius: "50%",
            background: "#C8412A",
            color: CREAM, fontSize: 9, fontWeight: "800",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            !
          </div>
        )}
      </div>

      {/* Wordmark + input — centered as one block */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "calc(100% - 28px)",
        maxWidth: MOBILE_MAX - 28,
      }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 32, fontWeight: "800", color: INK, letterSpacing: "-0.03em" }}>LIVABLE</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.45)", borderRadius: 8, padding: "20px 18px", boxShadow: "0 2px 16px rgba(0,0,0,0.07)" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 8, textAlign: "center" }}>
            Paste or type an address
          </div>
          <input
            style={{ ...inputStyle }}
            placeholder="e.g. 2847 Elmwood Ave, Indianapolis IN"
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleGo()}
            autoFocus
          />
          {error && (
            <div style={{ fontSize: 11, color: HOUSING_COLOR, marginTop: 8 }}>{error}</div>
          )}
          <button style={{ ...btnPrimary(loading || !address.trim()), marginTop: 12 }} onClick={handleGo}>
            {loading ? "Looking up property…" : "See If It Fits →"}
          </button>
        </div>
      </div>

      {/* Free looks counter — pinned bottom */}
      <div style={{
        position: "absolute",
        bottom: 24, left: 0, right: 0,
        textAlign: "center",
        fontSize: 10, color: MUTED, letterSpacing: "0.08em",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {usesLeft > 0 ? `${3 - usesLeft} of 3 free looks used` : "3 of 3 free looks used"}
      </div>
    </div>
  );
}

// ── Screen: Paywall ───────────────────────────────────────────────────────
function PaywallOverlay({ onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(20,18,10,0.88)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: BG, borderRadius: 10, padding: "32px 28px",
        maxWidth: 360, width: "100%", textAlign: "center",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 28, fontWeight: "800", color: INK, letterSpacing: "-0.02em", marginBottom: 6 }}>LIVABLE</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 24, lineHeight: 1.5 }}>
          You've used your 3 free looks.<br />Unlock unlimited searches.
        </div>
        <div style={{
          background: INK, borderRadius: 6, padding: "20px",
          marginBottom: 20, color: CREAM,
        }}>
          <div style={{ fontSize: 28, fontWeight: "800", letterSpacing: "-0.02em" }}>$4.99</div>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", opacity: 0.6, textTransform: "uppercase", marginTop: 2 }}>per month</div>
          <div style={{ marginTop: 14, fontSize: 11, lineHeight: 1.8, opacity: 0.85 }}>
            ✓ Unlimited address searches<br />
            ✓ Live interest rate updates<br />
            ✓ Shareable PDF with AI summary<br />
            ✓ Save & compare homes
          </div>
        </div>
        <button style={{ ...btnPrimary(false), marginBottom: 10, background: "#C8412A" }}>
          Unlock for $4.99/mo
        </button>
        <div style={{ fontSize: 10, color: MUTED, cursor: "pointer" }} onClick={onClose}>
          Maybe later
        </div>
      </div>
    </div>
  );
}

// ── Screen: Map ────────────────────────────────────────────────────────────
function MapScreen({ property, profile, shareCount, onBack, onShare, onCatAmountChange, onEditProfile }) {
  const [rate, setRate]       = useState(CURRENT_RATE);
  const [downPct, setDownPct] = useState(profile.downPct);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [tiles, setTiles]     = useState([]);
  const [dims, setDims]       = useState({ w: 600, h: 300 });
  const [editingTile, setEditingTile]   = useState(null);
  const [editingAmount, setEditingAmt]  = useState("");
  const [photoExpanded, setPhotoExpanded] = useState(false);
  const containerRef = useRef(null);
  const GAP = 3;

  const inc = profile.income;

  // Build tiles
  useEffect(() => {
    const payment = monthlyPayment(property.price, downPct, rate);
    const pmi = pmiMonthly(property.price, downPct);
    const taxes = Math.round(property.price * 0.012 / 12);
    const insurance = Math.round(property.price * 0.005 / 12);
    const housingMonthly = payment + pmi + taxes + insurance;

    const treemapCats = profile.cats.filter(c =>
      c.kind === "recurring" || c.kind === "savings"
    );
    setTiles([
      { id: "housing", label: "Housing", value: housingMonthly, locked: true, color: HOUSING_COLOR },
      { id: "needs", label: "Essentials", value: Math.max(profile.essentialsTotal, 1), locked: true, color: NEEDS_COLOR },
      ...treemapCats.map((cat, i) => ({
        id: cat.id,
        label: cat.label,
        value: Math.max(cat.monthly || 0, 1),
        color: CAT_COLORS[i % CAT_COLORS.length],
        locked: false,
        custom: cat.custom,
        kind: cat.kind,
      })),
    ]);
  }, [property, profile, rate, downPct, inc]);

  // Resize observer
  useEffect(() => {
    const ro = new ResizeObserver(entries => {
      for (const e of entries)
        setDims({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Block scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const block = e => e.preventDefault();
    ["touchmove","wheel","gesturestart","gesturechange","gestureend"]
      .forEach(ev => el.addEventListener(ev, block, { passive: false }));
    return () => {
      ["touchmove","wheel","gesturestart","gesturechange","gestureend"]
        .forEach(ev => el.removeEventListener(ev, block));
    };
  }, []);

  const nonTreemapCats  = profile.cats.filter(c => c.kind !== "recurring" && c.kind !== "savings");
  const housingTile     = tiles.find(t => t.id === "housing");
  const needsTile       = tiles.find(t => t.id === "needs");
  const lifestyleTiles  = tiles.filter(t => t.id !== "housing" && t.id !== "needs");
  const housingPct      = housingTile ? (housingTile.value / inc) * 100 : 0;
  const verdict         = computeVerdict({ tiles, profile, property, housingPct });

  const lifestyleTotal  = profile.cats
    .filter(c => c.kind === "recurring" || c.kind === "savings")
    .reduce((s, c) => s + (c.monthly || 0), 0);
  const lifestyleBudget = Math.max(inc - (housingTile?.value || 0) - profile.essentialsTotal, 0);
  const lifestyleSurplus = lifestyleBudget - lifestyleTotal;

  const BAND_GAP = 2;
  const housingBandH    = housingTile
    ? Math.round(Math.max(dims.h * 0.30, Math.min(dims.h * 0.55, dims.h * housingPct / 100)))
    : Math.round(dims.h * 0.40);
  const essentialsBandH = Math.round(dims.h * 0.15);
  const lifestyleBandH  = Math.max(0, dims.h - housingBandH - essentialsBandH - BAND_GAP * 2);

  const unallocatedTile = lifestyleSurplus > 0
    ? [{ id: "unallocated", label: "Unallocated", value: lifestyleSurplus, color: "#b5ad98", locked: true, kind: "unallocated" }]
    : [];
  const lifestyleBandTiles = [...lifestyleTiles, ...unallocatedTile].filter(t => t.value > 0);
  const lifestyleRects  = computeBandRects(lifestyleBandTiles, dims.w, lifestyleBandH, GAP);

  const confirmEdit = useCallback(() => {
    const val = parseFloat(editingAmount);
    if (isNaN(val) || val < 0) return;
    const newVal = Math.max(val, 0);
    setTiles(prev => prev.map(t => t.id === editingTile ? { ...t, value: newVal } : t));
    if (onCatAmountChange) onCatAmountChange(editingTile, newVal);
    setEditingTile(null);
    setEditingAmt("");
  }, [editingTile, editingAmount, onCatAmountChange]);

  const streetViewUrl = `/api/streetview?address=${encodeURIComponent(property.address)}`;

  return (
    <div style={{
      width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto",
      display: "flex", flexDirection: "column",
      flex: 1, minHeight: 0,
      padding: "calc(env(safe-area-inset-top, 0px) + 8px) 14px calc(env(safe-area-inset-bottom, 0px) + 8px)",
      boxSizing: "border-box",
      gap: 6,
    }}>

      {/* Photo fullscreen modal */}
      {photoExpanded && (
        <div
          onClick={() => setPhotoExpanded(false)}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,8,4,0.95)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ width: "100%", maxWidth: 700, padding: 20 }}>
            <div style={{ borderRadius: 8, overflow: "hidden", height: 320, background: "#2e2a18" }}>
              <img src={streetViewUrl} alt={property.address} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ textAlign: "center", marginTop: 14, fontSize: 10, color: "rgba(250,245,232,0.4)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Tap anywhere to close
            </div>
          </div>
        </div>
      )}

      {/* Assumptions overlay */}
      {showAssumptions && (
        <div
          onClick={() => setShowAssumptions(false)}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(20,18,10,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: MOBILE_MAX,
              background: BG, borderRadius: "14px 14px 0 0",
              padding: "20px 18px",
              paddingBottom: "max(20px, env(safe-area-inset-bottom, 20px))",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase" }}>Adjust assumptions</div>
              <div onClick={() => setShowAssumptions(false)} style={{ fontSize: 20, color: MUTED, cursor: "pointer", lineHeight: 1, padding: "2px 6px" }}>×</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 9, letterSpacing: "0.14em", color: MUTED, textTransform: "uppercase" }}>30yr fixed rate</span>
                <span style={{ fontSize: 11, fontWeight: "700", color: INK }}>{rate.toFixed(2)}%</span>
              </div>
              <input type="range" min={3} max={12} step={0.05} value={rate}
                onChange={e => setRate(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: INK }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: MUTED, marginTop: 2 }}>
                <span>3%</span><span style={{ color: "#4A9B6F" }}>Current: {CURRENT_RATE}%</span><span>12%</span>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 9, letterSpacing: "0.14em", color: MUTED, textTransform: "uppercase" }}>Down payment</span>
                <span style={{ fontSize: 11, fontWeight: "700", color: INK }}>
                  {downPct}%{downPct < 20 && <span style={{ fontSize: 8, color: "#D97B3A", marginLeft: 4 }}>PMI</span>}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {["5","10","15","20","25","30"].map(p => (
                  <div key={p} onClick={() => setDownPct(parseFloat(p))} style={{
                    flex: 1, textAlign: "center", padding: "7px 0",
                    background: downPct === parseFloat(p) ? INK : "rgba(255,255,255,0.5)",
                    border: `1.5px solid ${downPct === parseFloat(p) ? INK : "rgba(100,90,60,0.2)"}`,
                    borderRadius: 3, fontSize: 10, fontWeight: "600",
                    color: downPct === parseFloat(p) ? CREAM : INK, cursor: "pointer",
                  }}>{p}%</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Property photo card */}
      <div
        onClick={() => setPhotoExpanded(true)}
        style={{
          borderRadius: 6, overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
          position: "relative", height: 130, background: INK,
          cursor: "pointer", flexShrink: 0,
        }}
      >
        <img src={streetViewUrl} alt={property.address} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />

        {/* Days-on-market badge */}
        {property.daysOnMarket != null && property.daysOnMarket < 7 && (
          <div style={{ position: "absolute", top: 6, right: 6, background: "#4A9B6F", borderRadius: 3, padding: "2px 6px", fontSize: 7, fontWeight: "800", color: CREAM, letterSpacing: "0.1em", textTransform: "uppercase", zIndex: 1 }}>
            Just listed
          </div>
        )}
        {property.daysOnMarket != null && property.daysOnMarket >= 90 && (
          <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(30,26,14,0.78)", borderRadius: 3, padding: "2px 6px", fontSize: 7, fontWeight: "700", color: "rgba(250,245,232,0.7)", letterSpacing: "0.06em", zIndex: 1 }}>
            {property.daysOnMarket}d on market
          </div>
        )}

        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(18,16,8,0.97) 0%, rgba(18,16,8,0.15) 60%, transparent 100%)",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
          padding: "0 14px 10px",
        }}>
          <div style={{ fontSize: 14, fontWeight: "700", color: CREAM, letterSpacing: "-0.01em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.2 }}>
            {property.address}
          </div>
          <div style={{ fontSize: 9, color: "rgba(250,245,232,0.5)", marginTop: 3, letterSpacing: "0.04em" }}>
            {[
              property.price ? `$${property.price.toLocaleString("en-US")}` : null,
              property.beds ? `${property.beds}bd` : null,
              property.baths ? `${property.baths}ba` : null,
              property.sqft ? `${property.sqft.toLocaleString("en-US")}sf` : null,
              property.lotSize ? `${(property.lotSize / 1000).toFixed(1)}k lot` : null,
              property.yearBuilt ? `${property.yearBuilt}` : null,
            ].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {/* Cost bar — merged with Adjust chip */}
      <div style={{
        background: INK, borderRadius: 4, padding: "7px 12px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 9, color: "rgba(250,245,232,0.45)", letterSpacing: "0.14em", textTransform: "uppercase" }}>Est. monthly</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: "800", color: CREAM }}>
            ${Math.round(housingTile?.value || 0).toLocaleString("en-US")}<span style={{ fontSize: 9, fontWeight: "400", opacity: 0.5 }}>/mo</span>
          </div>
          <div
            onClick={() => setShowAssumptions(true)}
            style={{
              fontSize: 8, color: "rgba(250,245,232,0.75)",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 3, padding: "3px 7px",
              letterSpacing: "0.1em", textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Adjust
          </div>
        </div>
      </div>

      {/* Verdict headline — above treemap (suppressed until tiles are ready) */}
      {housingTile && <div style={{
        flexShrink: 0,
        background: `${verdict.color}18`,
        border: `1.5px solid ${verdict.color}44`,
        borderRadius: 6,
        padding: "8px 12px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ flexShrink: 0, background: verdict.color, borderRadius: 3, padding: "4px 10px" }}>
          <div style={{ fontSize: 9, fontWeight: "800", color: CREAM, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            {verdict.label}
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: "700", color: INK, letterSpacing: "-0.01em" }}>{verdict.headline}</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{verdict.subline}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          {[
            { key: "F", score: verdict.financial },
            { key: "L", score: verdict.lifestyle },
            { key: "P", score: verdict.property },
          ].map(({ key, score }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ fontSize: 7, color: MUTED, letterSpacing: "0.06em", width: 8, textAlign: "right" }}>{key}</div>
              <div style={{ width: 32, height: 3, background: "rgba(0,0,0,0.1)", borderRadius: 2 }}>
                <div style={{ width: `${score}%`, height: "100%", background: verdict.color, borderRadius: 2, opacity: 0.85 }} />
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* Three-Band Treemap */}
      <div
        ref={containerRef}
        style={{
          flex: "1 1 auto",
          position: "relative", borderRadius: 6,
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,0.14)",
          touchAction: "none", overscrollBehavior: "none",
        }}
      >
        {housingTile && <>

          {/* ── HOUSING BAND — WHERE YOU LIVE ── */}
          <div
            onClick={() => setShowAssumptions(true)}
            style={{
              position: "absolute", left: 0, top: 0,
              width: "100%", height: housingBandH,
              background: HOUSING_COLOR, borderRadius: 6,
              cursor: "pointer", overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0 14px", boxSizing: "border-box",
            }}
          >
            <div style={{ position: "absolute", top: 4, left: 10, fontSize: 6, letterSpacing: "0.22em", color: "rgba(250,245,232,0.38)", textTransform: "uppercase", pointerEvents: "none" }}>WHERE YOU LIVE</div>
            <div>
              <div style={{ fontSize: Math.max(8, Math.min(11, housingBandH / 6)), fontWeight: "700", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(250,245,232,0.72)" }}>Housing</div>
              {housingBandH > 58 && (
                <div style={{ fontSize: Math.max(9, Math.min(12, housingBandH / 6)), color: "rgba(250,245,232,0.5)", marginTop: 2 }}>
                  ${Math.round(housingTile.value).toLocaleString("en-US")}/mo
                </div>
              )}
            </div>
            <div style={{ fontSize: Math.max(20, Math.min(42, housingBandH * 0.52)), fontWeight: "800", color: CREAM, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {(housingTile.value / inc * 100).toFixed(0)}%
            </div>
          </div>

          {/* ── ESSENTIALS BAND — WHAT YOU NEED ── */}
          <div
            onClick={onEditProfile}
            style={{
              position: "absolute", left: 0, top: housingBandH + BAND_GAP,
              width: "100%", height: essentialsBandH,
              background: NEEDS_COLOR, borderRadius: 4,
              cursor: onEditProfile ? "pointer" : "default", overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0 12px", boxSizing: "border-box",
            }}
          >
            <div style={{ position: "absolute", top: 3, left: 10, fontSize: 6, letterSpacing: "0.22em", color: "rgba(250,245,232,0.32)", textTransform: "uppercase", pointerEvents: "none" }}>WHAT YOU NEED</div>
            <div style={{ fontSize: 9, fontWeight: "700", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(250,245,232,0.72)" }}>Essentials</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 9, color: "rgba(250,245,232,0.5)" }}>${Math.round(needsTile?.value || 0).toLocaleString("en-US")}/mo</div>
              <div style={{ fontSize: 16, fontWeight: "800", color: CREAM, letterSpacing: "-0.01em" }}>
                {((needsTile?.value || 0) / inc * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          {/* ── LIFESTYLE BAND — HOW YOU LIVE ── */}
          <div
            style={{
              position: "absolute", left: 0, top: housingBandH + essentialsBandH + BAND_GAP * 2,
              width: "100%", height: lifestyleBandH,
              borderRadius: 4, overflow: "hidden",
            }}
          >
            {lifestyleBandTiles.length === 0 && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 7, letterSpacing: "0.22em", color: MUTED, textTransform: "uppercase", marginBottom: 5 }}>HOW YOU LIVE</div>
                  <div style={{ fontSize: 10, color: MUTED }}>Tap edit profile to add lifestyle priorities</div>
                </div>
              </div>
            )}

            {lifestyleRects.map(rect => {
              const tile = lifestyleBandTiles.find(t => t.id === rect.id);
              if (!tile) return null;
              const isUnalloc = tile.id === "unallocated";
              const pct = (tile.value / inc * 100).toFixed(0);
              const pad = rect.w < 50 ? 5 : 8;
              const pctSize   = Math.max(10, Math.min(24, Math.min(rect.w / 3.6, rect.h / 2.6)));
              const labelSize = Math.max(7, Math.min(9, rect.w / 9));
              const moSize    = Math.max(6, Math.min(8, rect.w / 9));
              const showLabel      = rect.w >= 50 && rect.h >= 20;
              const showPercentage = showLabel && rect.h >= 28;
              const showDollar     = showLabel && rect.h >= 40;

              return (
                <div
                  key={rect.id}
                  onClick={() => {
                    if (isUnalloc || tile.locked) return;
                    const cat = profile.cats.find(c => c.id === tile.id);
                    setEditingTile(tile.id);
                    setEditingAmt(String(Math.round(cat?.monthly || 0)));
                  }}
                  style={{
                    position: "absolute",
                    left: rect.x, top: rect.y,
                    width: Math.max(0, rect.w), height: Math.max(0, rect.h),
                    background: isUnalloc
                      ? `repeating-linear-gradient(135deg, ${tile.color}80 0px, ${tile.color}80 5px, ${tile.color}44 5px, ${tile.color}44 10px)`
                      : tile.kind === "savings"
                      ? `repeating-linear-gradient(45deg, ${tile.color}, ${tile.color} 6px, ${darkenHex(tile.color, 25)} 6px, ${darkenHex(tile.color, 25)} 12px)`
                      : tile.color,
                    borderRadius: 5,
                    overflow: "hidden",
                    cursor: isUnalloc ? "default" : "pointer",
                    transition: "width 0.18s ease, height 0.18s ease",
                  }}
                >
                  {isUnalloc ? (
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: `${pad}px`, overflow: "hidden" }}>
                      {showLabel && <div style={{ fontSize: labelSize, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "600", color: "rgba(30,26,14,0.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>UNALLOCATED</div>}
                      {showDollar && <div style={{ fontSize: moSize, color: "rgba(30,26,14,0.35)", marginTop: 2, whiteSpace: "nowrap" }}>${Math.round(tile.value).toLocaleString("en-US")}/mo · room to grow</div>}
                    </div>
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: `${pad}px`, color: "rgba(252,246,224,0.96)", textShadow: "0 1px 3px rgba(0,0,0,0.3)", overflow: "hidden" }}>
                      {showLabel && <div style={{ fontSize: labelSize, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: "600", marginBottom: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.82 }}>{tile.label}</div>}
                      {showPercentage && <div style={{ fontSize: pctSize, fontWeight: "800", lineHeight: 1, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>{pct}%</div>}
                      {showDollar && <div style={{ fontSize: moSize, opacity: 0.62, marginTop: 2, whiteSpace: "nowrap" }}>${Math.round(tile.value).toLocaleString("en-US")}/mo</div>}
                    </div>
                  )}
                  {!isUnalloc && rect.w >= 55 && rect.h >= 48 && (
                    <div style={{ position: "absolute", bottom: 4, right: 4, opacity: 0.4, pointerEvents: "none" }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={CREAM} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}

            {/* HOW YOU LIVE label — when tiles present */}
            {lifestyleBandTiles.length > 0 && (
              <div style={{ position: "absolute", top: 4, left: 8, fontSize: 6, letterSpacing: "0.22em", color: "rgba(30,26,14,0.22)", textTransform: "uppercase", pointerEvents: "none", zIndex: 1 }}>HOW YOU LIVE</div>
            )}

            {/* Deficit chip */}
            {lifestyleSurplus < 0 && (
              <div style={{ position: "absolute", top: 6, right: 8, background: "rgba(200,65,42,0.92)", borderRadius: 3, padding: "3px 7px", zIndex: 2 }}>
                <div style={{ fontSize: 8, fontWeight: "700", color: CREAM, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
                  Over by ${Math.round(-lifestyleSurplus).toLocaleString("en-US")}/mo
                </div>
              </div>
            )}
          </div>

          {/* Tile edit popover */}
          {editingTile && (
            <div
              style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
              onClick={() => { setEditingTile(null); setEditingAmt(""); }}
            >
              <div onClick={e => e.stopPropagation()} style={{ background: BG, borderRadius: 8, padding: "18px 16px", width: 220, boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
                <div style={{ fontSize: 9, color: MUTED, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 10 }}>
                  {lifestyleTiles.find(t => t.id === editingTile)?.label} — monthly
                </div>
                <div style={{ position: "relative", marginBottom: 10 }}>
                  <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED }}>$</span>
                  <input
                    autoFocus type="number" inputMode="numeric"
                    value={editingAmount}
                    onChange={e => setEditingAmt(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") confirmEdit(); if (e.key === "Escape") { setEditingTile(null); setEditingAmt(""); } }}
                    style={{ ...inputStyle, paddingLeft: 22, fontSize: 16 }}
                  />
                </div>
                <button onClick={confirmEdit} disabled={!editingAmount} style={{ ...btnPrimary(!editingAmount), padding: "9px 14px", fontSize: 9 }}>
                  Update
                </button>
              </div>
            </div>
          )}
        </>}
      </div>

      {/* Actions + nonTreemapCats */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>

        {nonTreemapCats.length > 0 && (
          <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.4)", borderRadius: 6 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.14em", color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
              Also matters to you
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {nonTreemapCats.map(c => (
                <div key={c.id} style={{ padding: "4px 8px", background: "rgba(255,255,255,0.5)", border: "1px solid rgba(100,90,60,0.25)", borderRadius: 12, fontSize: 10, color: INK }}>
                  {c.label}
                  {c.kind === "property" && c.propertyNeed && (
                    <span style={{ color: MUTED, marginLeft: 4 }}>· needs {c.propertyNeed}</span>
                  )}
                  {c.kind === "one_time" && (
                    <span style={{ color: MUTED, marginLeft: 4 }}>· one-time</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={{ ...btnPrimary(false), background: "transparent", color: INK, border: `1.5px solid rgba(100,90,60,0.3)`, width: "auto", padding: "10px 16px", fontSize: 9 }}
            onClick={onBack}
          >← New</button>
          <button
            style={{ ...btnPrimary(false), background: "#C8412A", flex: 1 }}
            onClick={() => onShare({ tiles, property, verdict, housingPct, rate, downPct })}
          >
            Share This Map ↗{shareCount < 3 ? ` · ${3 - shareCount} free` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Animated house loader ──────────────────────────────────────────────────
const LOADING_QUIPS = [
  "Crunching the numbers so you don't have to...",
  "Asking the walls how they feel about your budget...",
  "Checking if your travel fund survives this...",
  "Consulting the mortgage gods...",
  "Running the math on your life choices...",
  "Figuring out what you'd have to give up...",
  "The house is thinking. Give it a moment.",
];

// Inject CSS keyframes once
if (typeof document !== "undefined" && !document.getElementById("livable-anim")) {
  const s = document.createElement("style");
  s.id = "livable-anim";
  s.innerHTML = `
    @keyframes livable-build {
      0%   { clip-path: inset(100% 0 0 0); opacity: 0; }
      15%  { opacity: 1; }
      80%  { clip-path: inset(0% 0 0 0); opacity: 1; }
      100% { clip-path: inset(0% 0 0 0); opacity: 1; }
    }
    @keyframes livable-roof {
      0%   { clip-path: inset(0 100% 0 0); opacity: 0; }
      15%  { opacity: 1; }
      80%  { clip-path: inset(0 0% 0 0); opacity: 1; }
      100% { clip-path: inset(0 0% 0 0); opacity: 1; }
    }
    @keyframes livable-fade {
      0%,60%  { opacity: 0; }
      80%,100% { opacity: 1; }
    }
    @keyframes livable-quip {
      0%   { opacity: 0; transform: translateY(4px); }
      12%  { opacity: 1; transform: translateY(0); }
      85%  { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-4px); }
    }
    @keyframes livable-pulse {
      0%, 100% { transform: scale(1); opacity: 0.7; }
      50% { transform: scale(1.06); opacity: 1; }
    }
    @keyframes livable-done-house {
      0%   { transform: scale(1); }
      30%  { transform: scale(1.18) translateY(-4px); }
      55%  { transform: scale(0.94) translateY(1px); }
      75%  { transform: scale(1.06) translateY(-2px); }
      100% { transform: scale(1) translateY(0); }
    }
    @keyframes livable-sparkle {
      0%   { transform: scale(0) rotate(0deg); opacity: 0; }
      40%  { transform: scale(1.4) rotate(180deg); opacity: 1; }
      70%  { transform: scale(0.9) rotate(260deg); opacity: 1; }
      100% { transform: scale(0) rotate(320deg); opacity: 0; }
    }
    @keyframes livable-ring {
      0%   { transform: scale(0.6); opacity: 0.8; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    @keyframes livable-done-text {
      0%   { opacity: 0; transform: translateY(6px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes livable-reveal {
      0%   { opacity: 0; max-height: 0; transform: translateY(-8px); }
      100% { opacity: 1; max-height: 2000px; transform: translateY(0); }
    }
  `;
  document.head.appendChild(s);
}

function HouseLoader({ done }) {
  const [quipIdx, setQuipIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (done) return;
    const quipTimer = setInterval(() => setQuipIdx(i => (i + 1) % LOADING_QUIPS.length), 2200);
    const animTimer = setInterval(() => setAnimKey(k => k + 1), 2000);
    return () => { clearInterval(quipTimer); clearInterval(animTimer); };
  }, [done]);

  useEffect(() => {
    if (!done) return;
    setShowDone(true);
  }, [done]);

  const dur = "1.6s";
  const ease = "cubic-bezier(0.34, 1.1, 0.64, 1)";

  const sparkles = [
    { x: 8,  y: 8,  size: 10, delay: "0s",    color: "#E8A030" },
    { x: 72, y: 5,  size: 8,  delay: "0.08s",  color: "#4A9B6F" },
    { x: 82, y: 28, size: 6,  delay: "0.14s",  color: "#3B7FC4" },
    { x: 4,  y: 32, size: 7,  delay: "0.06s",  color: "#D4505A" },
    { x: 42, y: 2,  size: 9,  delay: "0.18s",  color: CREAM     },
    { x: 18, y: 18, size: 5,  delay: "0.22s",  color: "#C4963B" },
    { x: 68, y: 18, size: 6,  delay: "0.10s",  color: "#7B5EA7" },
  ];

  return (
    <div style={{ textAlign: "center", padding: "24px 0 16px" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, position: "relative", height: 90 }}>

        {showDone && (
          <div style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 60, height: 60,
            borderRadius: "50%",
            border: `2px solid ${HOUSING_COLOR}`,
            animation: "livable-ring 0.7s ease-out forwards",
            pointerEvents: "none",
          }} />
        )}

        <svg
          key={showDone ? "done" : animKey}
          width="90" height="76" viewBox="0 0 90 76"
          style={{
            animation: showDone
              ? "livable-done-house 0.55s cubic-bezier(0.34,1.4,0.64,1) forwards"
              : "livable-pulse 2s ease-in-out infinite",
            overflow: "visible",
            position: "relative", zIndex: 2,
          }}
        >
          <line x1="5" y1="72" x2="85" y2="72" stroke={MUTED} strokeWidth="1" opacity="0.25"/>
          <rect x="18" y="62" width="54" height="8" fill={HOUSING_COLOR} opacity="0.85" rx="1"
            style={{ animation: `livable-build ${dur} ${ease} forwards` }}/>
          <rect x="18" y="34" width="54" height="28" fill={HOUSING_COLOR} opacity="0.72"
            style={{ animation: `livable-build ${dur} ${ease} forwards`, animationDelay: "0.15s" }}/>
          <polygon points="45,9 12,34 78,34" fill={HOUSING_COLOR} opacity="0.95"
            style={{ animation: `livable-roof ${dur} ${ease} forwards`, animationDelay: "0.35s" }}/>
          <rect x="37" y="44" width="12" height="18" fill={CREAM} opacity="0.55" rx="1"
            style={{ animation: `livable-fade ${dur} ease forwards`, animationDelay: "0.55s" }}/>
          <rect x="57" y="40" width="10" height="10" fill={CREAM} opacity="0.5" rx="1"
            style={{ animation: `livable-fade ${dur} ease forwards`, animationDelay: "0.65s" }}/>
          <line x1="62" y1="40" x2="62" y2="50" stroke={HOUSING_COLOR} strokeWidth="1.2" opacity="0.6"
            style={{ animation: `livable-fade ${dur} ease forwards`, animationDelay: "0.65s" }}/>
          <line x1="57" y1="45" x2="67" y2="45" stroke={HOUSING_COLOR} strokeWidth="1.2" opacity="0.6"
            style={{ animation: `livable-fade ${dur} ease forwards`, animationDelay: "0.65s" }}/>
          <rect x="56" y="14" width="8" height="14" fill={HOUSING_COLOR} opacity="0.85" rx="1"
            style={{ animation: `livable-fade ${dur} ease forwards`, animationDelay: "0.45s" }}/>

          {showDone && sparkles.map((sp, i) => (
            <g key={i} transform={`translate(${sp.x}, ${sp.y})`}>
              <path
                d={`M0,-${sp.size/2} L${sp.size/6},${-sp.size/6} L${sp.size/2},0 L${sp.size/6},${sp.size/6} L0,${sp.size/2} L${-sp.size/6},${sp.size/6} L${-sp.size/2},0 L${-sp.size/6},${-sp.size/6} Z`}
                fill={sp.color}
                style={{ animation: `livable-sparkle 0.7s ${sp.delay} ease-out forwards`, opacity: 0 }}
              />
            </g>
          ))}
        </svg>
      </div>

      {showDone ? (
        <div style={{
          fontSize: 12, color: INK, fontWeight: "600",
          letterSpacing: "0.06em", textTransform: "uppercase",
          animation: "livable-done-text 0.4s 0.3s ease-out both",
        }}>
          Your summary is ready
        </div>
      ) : (
        <div
          key={quipIdx}
          style={{
            fontSize: 11, color: MUTED, fontStyle: "italic",
            letterSpacing: "0.02em", lineHeight: 1.5,
            minHeight: 36, padding: "0 16px",
            animation: "livable-quip 2.2s ease both",
          }}
        >
          {LOADING_QUIPS[quipIdx]}
        </div>
      )}
    </div>
  );
}

// ── Screen: Share / Export ─────────────────────────────────────────────────
function ShareScreen({ data, profile, cachedSummary, onSummaryReady, onClose }) {
  const [summary, setSummary]   = useState(cachedSummary);
  const [loading, setLoading]   = useState(!cachedSummary);
  const [done, setDone]         = useState(false);
  const [revealed, setRevealed] = useState(!!cachedSummary);
  const { tiles, property, verdict, housingPct, rate, downPct } = data;
  const inc = profile.income;

  useEffect(() => {
    if (cachedSummary) { setSummary(cachedSummary); setLoading(false); setRevealed(true); return; }
    generateSummary({
      property: {
        address: property.address,
        price: property.price,
        beds: property.beds,
        baths: property.baths,
        sqft: property.sqft,
        yearBuilt: property.yearBuilt,
        lotSize: property.lotSize,
        propertyType: property.propertyType,
        daysOnMarket: property.daysOnMarket,
        city: property.city,
        state: property.state,
        zipCode: property.zipCode,
      },
      monthlyHousing: tiles.find(t => t.id === "housing")?.value || 0,
      income: inc,
      essentialsTotal: profile.essentialsTotal,
      housingPct,
      verdict,
      cats: profile.cats.map(c => ({ label: c.label, kind: c.kind, monthly: c.monthly || null, propertyNeed: c.propertyNeed || null })),
      lifestyleBudget: Math.max(inc - (tiles.find(t => t.id === "housing")?.value || 0) - profile.essentialsTotal, 0),
      lifestyleTotal: profile.cats.filter(c => c.kind === "recurring" || c.kind === "savings").reduce((s, c) => s + (c.monthly || 0), 0),
      downPct,
      rate,
    }).then(text => {
      setSummary(text);
      onSummaryReady(text);
      setDone(true);
      setTimeout(() => setLoading(false), 900);
      setTimeout(() => setRevealed(true), 950);
    });
  }, []);

  const SVG_W = 480, SVG_H = 200, SVG_GAP = 3;
  const shareRects = computeRects(tiles, SVG_W, SVG_H, SVG_GAP);

  return (
    <div style={{
      height: "100%", overflowY: "auto", overscrollBehavior: "contain",
      paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
      paddingLeft: 14, paddingRight: 14,
      boxSizing: "border-box",
    }}>
    <div style={{ width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto" }}>
      <div id="livable-export-card" style={{
        background: CREAM, borderRadius: 8,
        boxShadow: "0 8px 40px rgba(0,0,0,0.15)",
        overflow: "hidden",
      }}>
        <div style={{ background: verdict.color, padding: "14px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 7, letterSpacing: "0.24em", color: "rgba(250,245,232,0.55)", textTransform: "uppercase", marginBottom: 4 }}>LIVABLE</div>
              <div style={{ fontSize: 18, fontWeight: "800", color: CREAM, letterSpacing: "-0.01em", lineHeight: 1.1 }}>{verdict.label}</div>
              <div style={{ fontSize: 9, color: "rgba(250,245,232,0.75)", marginTop: 4, maxWidth: 220 }}>{verdict.headline} {verdict.subline}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 9, color: "rgba(250,245,232,0.55)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Housing</div>
              <div style={{ fontSize: 22, fontWeight: "800", color: CREAM, lineHeight: 1 }}>{housingPct.toFixed(0)}%</div>
              <div style={{ fontSize: 8, color: "rgba(250,245,232,0.55)" }}>of income</div>
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 20px 20px" }}>

          <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid rgba(0,0,0,0.08)` }}>
            <div style={{ fontSize: 13, fontWeight: "700", color: INK }}>{property.address}</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
              {[
                property.price ? `$${property.price.toLocaleString("en-US")}` : null,
                (property.beds || property.baths) ? `${property.beds || 0}bd ${property.baths || 0}ba` : null,
                `$${Math.round(tiles.find(t=>t.id==="housing")?.value||0).toLocaleString("en-US")}/mo`,
                `${rate}%`,
                `${downPct}% down`,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>

          <div style={{ marginBottom: 14, borderRadius: 4, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.1)" }}>
            <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
              <defs>
                {tiles.filter(t => t.kind === "savings").map(t => (
                  <pattern key={`sp-${t.id}`} id={`sp-${t.id}`} patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)">
                    <rect width="6" height="12" fill={t.color} />
                    <rect x="6" width="6" height="12" fill={darkenHex(t.color, 25)} />
                  </pattern>
                ))}
              </defs>
              {shareRects.map(rect => {
                const tile = tiles.find(t => t.id === rect.id);
                if (!tile) return null;
                const pct = (tile.value / inc) * 100;
                const pad = 5;
                const avail = rect.w - pad * 2;
                const tileFill = tile.kind === "savings" ? `url(#sp-${tile.id})` : tile.color;

                const labelSize = Math.max(5, Math.min(8, avail / (tile.label.length * 0.65)));
                const pctSize   = Math.max(7, Math.min(18, avail / 3.2));
                const moSize    = Math.max(5, Math.min(7, avail / 7));
                const moText    = `$${Math.round(tile.value).toLocaleString("en-US")}/mo`;

                const useVert = avail < 38 && rect.h > 50;
                const stackH  = labelSize + 3 + pctSize + 3 + moSize;
                const fitsH   = stackH < rect.h - pad * 2;

                if (!fitsH && !useVert) {
                  return (
                    <g key={rect.id}>
                      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={tileFill} rx={6} />
                      <text x={rect.x + rect.w/2} y={rect.y + rect.h/2 + pctSize*0.35}
                        fontSize={Math.min(pctSize, rect.h * 0.4)} fill="rgba(252,246,224,0.96)"
                        fontFamily="Futura, Century Gothic, sans-serif" fontWeight="800"
                        textAnchor="middle">
                        {pct.toFixed(0)}%
                      </text>
                    </g>
                  );
                }

                if (useVert) {
                  return (
                    <g key={rect.id}>
                      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={tileFill} rx={6} />
                      <text x={rect.x + rect.w/2} y={rect.y + rect.h - pad - moSize - 2}
                        fontSize={Math.min(pctSize, rect.w * 0.6)} fill="rgba(252,246,224,0.96)"
                        fontFamily="Futura, Century Gothic, sans-serif" fontWeight="800"
                        textAnchor="middle">
                        {pct.toFixed(0)}%
                      </text>
                      <text x={rect.x + rect.w/2} y={rect.y + rect.h - pad}
                        fontSize={moSize} fill="rgba(252,246,224,0.6)"
                        fontFamily="Futura, Century Gothic, sans-serif"
                        textAnchor="middle">
                        {moText}
                      </text>
                      <text
                        x={rect.x + rect.w - pad} y={rect.y + rect.h - pad - moSize - pctSize - 6}
                        fontSize={labelSize} fill="rgba(252,246,224,0.8)"
                        fontFamily="Futura, Century Gothic, sans-serif" fontWeight="600"
                        transform={`rotate(-90, ${rect.x + rect.w - pad}, ${rect.y + rect.h - pad - moSize - pctSize - 6})`}
                        textAnchor="start">
                        {tile.label.toUpperCase()}
                      </text>
                    </g>
                  );
                }

                return (
                  <g key={rect.id}>
                    <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={tileFill} rx={6} />
                    <text x={rect.x + pad} y={rect.y + pad + labelSize}
                      fontSize={labelSize} fill="rgba(252,246,224,0.82)"
                      fontFamily="Futura, Century Gothic, sans-serif" fontWeight="600">
                      {tile.label.toUpperCase()}
                    </text>
                    <text x={rect.x + pad} y={rect.y + pad + labelSize + 3 + pctSize}
                      fontSize={pctSize} fill="rgba(252,246,224,0.96)"
                      fontFamily="Futura, Century Gothic, sans-serif" fontWeight="800">
                      {pct.toFixed(0)}%
                    </text>
                    <text x={rect.x + pad} y={rect.y + pad + labelSize + 3 + pctSize + 3 + moSize}
                      fontSize={moSize} fill="rgba(252,246,224,0.62)"
                      fontFamily="Futura, Century Gothic, sans-serif">
                      {moText}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* AI Summary */}
          <div style={{ marginBottom: 14 }}>
            {loading ? <HouseLoader done={done} /> : null}
            {!loading && revealed && summary ? (
              <div style={{
                animation: cachedSummary ? "none" : "livable-reveal 0.6s cubic-bezier(0.16,1,0.3,1) both",
                fontSize: 13, color: INK, lineHeight: 1.65,
                padding: "4px 0",
              }}>
                {summary}
              </div>
            ) : null}
            {!loading && (!summary || summary.trim().length === 0) && (
              <div style={{
                background: "rgba(200,65,42,0.08)",
                border: "1px solid rgba(200,65,42,0.3)",
                borderRadius: 6, padding: "12px 14px",
                fontSize: 11, color: INK, lineHeight: 1.5,
              }}>
                We couldn't generate the summary right now. The math and breakdown below are still accurate.
              </div>
            )}
          </div>

          {/* Budget breakdown table */}
          <div style={{ paddingTop: 12, borderTop: `1px solid rgba(0,0,0,0.08)` }}>
            <div style={{ fontSize: 8, letterSpacing: "0.2em", color: MUTED, textTransform: "uppercase", marginBottom: 8 }}>
              Monthly Breakdown · ${inc.toLocaleString("en-US")} take-home
            </div>
            {tiles.filter(t => t.value > 0).map(t => {
              const pct = (t.value / inc) * 100;
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, background: t.color, borderRadius: 2, flexShrink: 0 }} />
                  <div style={{ fontSize: 10, color: INK, flex: 1 }}>{t.label}{t.locked ? " — Fixed" : ""}</div>
                  <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{pct.toFixed(1)}%</div>
                  <div style={{ fontSize: 10, fontWeight: "700", color: INK, fontFamily: "monospace" }}>${Math.round(t.value).toLocaleString("en-US")}/mo</div>
                  <div style={{ width: 50, height: 3, background: "rgba(0,0,0,0.07)", borderRadius: 2 }}>
                    <div style={{ width: `${Math.min(100, pct * 2.5)}%`, height: "100%", background: t.color, borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid rgba(0,0,0,0.06)`, textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "rgba(0,0,0,0.22)", letterSpacing: "0.16em", textTransform: "uppercase" }}>
              Generated with LIVABLE · livable.app
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button style={{ ...btnPrimary(false), background: "transparent", color: INK, border: `1.5px solid rgba(100,90,60,0.3)`, width: "auto", padding: "10px 16px", fontSize: 9 }} onClick={onClose}>
          ← Back
        </button>
        <button
          style={{ ...btnPrimary(false), background: INK, flex: 1 }}
          onClick={async () => {
            try {
              const res = await fetch("/api/pdf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ property, tiles, verdict, housingPct, rate, downPct, summary, income: inc }),
              });
              const blob = await res.blob();
              const file = new File([blob], "livable-summary.pdf", { type: "application/pdf" });
              if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: "LIVABLE", text: `${property.address} — does this home fit your life?` });
              } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = "livable-summary.pdf"; a.click();
                URL.revokeObjectURL(url);
              }
            } catch (e) {
              console.error("PDF export failed:", e);
              alert("Could not generate PDF. Please try again.");
            }
          }}
        >
          Export as PDF ↓
        </button>
      </div>
    </div>
    </div>
  );
}

// ── Profile editor overlay ─────────────────────────────────────────────────
function ProfileEditorOverlay({ profile, onSave, onClose, onStartOver }) {
  const [income, setIncome]         = useState(profile.income.toString());
  const [essentials, setEssentials] = useState(profile.essentials || {});
  const [downPct, setDownPct]       = useState(profile.downPct.toString());
  const [selectedCats, setSelected]        = useState(profile.cats);
  const [pendingCategory, setPendingCat]   = useState(null); // { id, label } | null
  const [pendingKind, setPendingKind]      = useState(null);
  const [pendingAmount, setPendingAmt]     = useState("");
  const [pendingPropertyNeed, setPendingPN] = useState("");
  const [customKind, setCustomKind]        = useState(null); // null=hidden, "label", "selecting", or kind
  const [customLabel, setCustomLabel]      = useState("");
  const [customAmount, setCustomAmount]    = useState("");
  const [customPropertyNeed, setCustomPN]  = useState("");
  const MAX_CATS = 5;

  const cancelPending = () => { setPendingCat(null); setPendingKind(null); setPendingAmt(""); setPendingPN(""); };

  const toggleCat = (id) => {
    const existingIdx = selectedCats.findIndex(c => c.id === id);
    if (existingIdx >= 0) { setSelected(prev => prev.filter((_, i) => i !== existingIdx)); return; }
    if (selectedCats.length >= MAX_CATS) return;
    const def = CATS.find(c => c.id === id);
    setPendingCat({ id, label: def?.label || id });
    setPendingKind(null); setPendingAmt(""); setPendingPN("");
  };

  const selectKind = (kind) => {
    if (kind === "one_time") {
      setSelected(prev => [...prev, { id: pendingCategory.id, label: pendingCategory.label, custom: false, kind: "one_time", monthly: null, propertyNeed: null }]);
      cancelPending(); return;
    }
    setPendingKind(kind);
  };

  const confirmPendingPick = () => {
    if (!pendingCategory || !pendingKind) return;
    const cat = {
      id: pendingCategory.id, label: pendingCategory.label, custom: false, kind: pendingKind,
      monthly: (pendingKind === "recurring" || pendingKind === "savings") ? (parseFloat(pendingAmount) || 0) : null,
      propertyNeed: pendingKind === "property" ? (pendingPropertyNeed.trim() || null) : null,
    };
    setSelected(prev => [...prev, cat]);
    cancelPending();
  };

  const essentialsTotal = Object.values(essentials).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: BG,
      overflowY: "auto",
      paddingBottom: "env(safe-area-inset-bottom)",
      fontFamily: font,
    }}>
      <div style={{ width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto", padding: "20px 14px 40px", paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)", boxSizing: "border-box" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
          <div onClick={onClose} style={{ fontSize: 28, color: INK, cursor: "pointer", lineHeight: 1, marginRight: 14 }}>×</div>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", color: INK, textTransform: "uppercase", fontWeight: "700" }}>Edit Profile</div>
        </div>

        {/* Income */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 8, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
            Monthly take-home pay
          </div>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13 }}>$</span>
            <input style={{ ...inputStyle, paddingLeft: 24 }} placeholder="e.g. 7500" value={income} onChange={e => setIncome(e.target.value)} type="number" inputMode="numeric" />
          </div>
        </div>

        {/* Essentials breakdown */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 8, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
            Monthly essentials
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {ESSENTIAL_FIELDS.map(f => (
              <div key={f.id}>
                <div style={{ fontSize: 9, letterSpacing: "0.14em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
                  {f.label}
                </div>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 14 }}>$</span>
                  <input
                    style={{ ...inputStyle, padding: "9px 11px 9px 22px" }}
                    placeholder={f.placeholder}
                    value={essentials[f.id] || ""}
                    onChange={e => setEssentials(prev => ({ ...prev, [f.id]: e.target.value }))}
                    type="number"
                    inputMode="numeric"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Down payment */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 8, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
            Down payment — {downPct}%
            {parseFloat(downPct) < 20 && <span style={{ color: "#D97B3A", marginLeft: 6 }}>PMI applies</span>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {["5","10","15","20","25","30"].map(p => (
              <div
                key={p}
                onClick={() => setDownPct(p)}
                style={{
                  flex: 1, textAlign: "center", padding: "7px 0",
                  background: downPct === p ? INK : "rgba(255,255,255,0.45)",
                  border: `1.5px solid ${downPct === p ? INK : "rgba(100,90,60,0.2)"}`,
                  borderRadius: 4, fontSize: 10, fontWeight: "600",
                  color: downPct === p ? CREAM : INK,
                  cursor: "pointer", fontFamily: font,
                  transition: "all 0.12s",
                }}
              >
                {p}%
              </div>
            ))}
          </div>
        </div>

        {/* Lifestyle priorities */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 9, fontWeight: "700", color: INK, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 2 }}>
            Top lifestyle priorities
          </div>
          <div style={{ fontSize: 8, color: MUTED, marginBottom: 6 }}>
            Tap in order. First tap = most important. Up to {MAX_CATS}.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {CATS.map((cat) => {
              const rank = selectedCats.findIndex(c => c.id === cat.id);
              const selected = rank !== -1;
              const isPending = pendingCategory?.id === cat.id;
              const atLimit = selectedCats.length >= MAX_CATS && !selected;
              return (
                <div
                  key={cat.id}
                  onClick={() => !isPending && toggleCat(cat.id)}
                  style={{
                    background: isPending ? `${CAT_COLORS[0]}18` : selected ? `${CAT_COLORS[rank % CAT_COLORS.length]}22` : "rgba(255,255,255,0.38)",
                    border: `1.5px solid ${isPending ? CAT_COLORS[0] : selected ? CAT_COLORS[rank % CAT_COLORS.length] : "rgba(100,90,60,0.18)"}`,
                    borderRadius: 6, padding: "10px 6px",
                    cursor: atLimit ? "default" : "pointer",
                    opacity: atLimit ? 0.38 : 1,
                    textAlign: "center", position: "relative",
                    transition: "all 0.12s",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: "700", color: INK, letterSpacing: "0.05em", textTransform: "uppercase" }}>{cat.label}</div>
                  {selected && (
                    <>
                      <div style={{
                        position: "absolute", top: -6, right: -6,
                        width: 18, height: 18, borderRadius: "50%",
                        background: CAT_COLORS[rank % CAT_COLORS.length],
                        color: CREAM, fontSize: 9, fontWeight: "800",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                      }}>
                        {rank + 1}
                      </div>
                      <div style={{ fontSize: 8, color: CAT_COLORS[rank % CAT_COLORS.length], marginTop: 2, opacity: 0.85 }}>
                        {catKindSublabel(selectedCats[rank])}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pending category — 3-stage kind flow */}
          {pendingCategory && (
            <div style={{ marginTop: 10, padding: 12, background: "rgba(255,255,255,0.6)", borderRadius: 6, border: "1.5px solid rgba(100,90,60,0.2)" }}>
              <div style={{ fontSize: 9, color: MUTED, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
                {pendingCategory.label} — how does it show up in your life?
              </div>
              {pendingKind === null ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { kind: "recurring", label: "Recurring monthly", sub: "Coffee, gym, dining out..." },
                    { kind: "savings",   label: "Saving toward it",  sub: "Vacation fund, gear savings..." },
                    { kind: "one_time",  label: "One-time cost",     sub: "Gear purchase, trip, event..." },
                    { kind: "property",  label: "Property requirement", sub: "Yard, garage, extra room..." },
                  ].map(({ kind, label, sub }) => (
                    <div key={kind} onClick={() => selectKind(kind)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: "rgba(255,255,255,0.5)", border: "1.5px solid rgba(100,90,60,0.2)", borderRadius: 5, cursor: "pointer" }}>
                      <div style={{ fontSize: 10, fontWeight: "700", color: INK }}>{label}</div>
                      <div style={{ fontSize: 8, color: MUTED }}>{sub}</div>
                    </div>
                  ))}
                  <button onClick={cancelPending} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>Cancel</button>
                </div>
              ) : pendingKind === "property" ? (
                <>
                  <div style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>What does {pendingCategory.label} need from the home?</div>
                  <input
                    autoFocus
                    placeholder="e.g. large yard, garage, extra bedroom..."
                    value={pendingPropertyNeed}
                    onChange={e => setPendingPN(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && pendingPropertyNeed.trim()) confirmPendingPick(); if (e.key === "Escape") cancelPending(); }}
                    style={{ ...inputStyle, fontSize: 16, marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={confirmPendingPick} disabled={!pendingPropertyNeed.trim()} style={{ ...btnPrimary(!pendingPropertyNeed.trim()), padding: "8px 14px", fontSize: 9 }}>Add</button>
                    <button onClick={cancelPending} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>{pendingKind === "savings" ? "How much are you saving per month?" : "Monthly budget?"}</div>
                  <div style={{ position: "relative", marginBottom: 8 }}>
                    <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED }}>$</span>
                    <input
                      autoFocus
                      placeholder="e.g. 200"
                      value={pendingAmount}
                      onChange={e => setPendingAmt(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") confirmPendingPick(); if (e.key === "Escape") cancelPending(); }}
                      type="number" inputMode="numeric"
                      style={{ ...inputStyle, paddingLeft: 22, fontSize: 16 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={confirmPendingPick} disabled={!pendingAmount} style={{ ...btnPrimary(!pendingAmount), padding: "8px 14px", fontSize: 9 }}>Add</button>
                    <button onClick={cancelPending} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Custom category chips */}
          {selectedCats.filter(c => c.custom).length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap" }}>
              {selectedCats.filter(c => c.custom).map(c => {
                const rank = selectedCats.findIndex(s => s.id === c.id);
                return (
                  <div key={c.id} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "6px 10px", marginRight: 6, marginBottom: 6,
                    background: `${CAT_COLORS[rank % CAT_COLORS.length]}22`,
                    border: `1.5px solid ${CAT_COLORS[rank % CAT_COLORS.length]}`,
                    borderRadius: 14, fontSize: 11, fontWeight: "700",
                    color: CAT_COLORS[rank % CAT_COLORS.length],
                  }}>
                    {rank + 1} {c.label} · {catKindSublabel(c)}
                    <span onClick={() => setSelected(prev => prev.filter(s => s.id !== c.id))} style={{ cursor: "pointer", marginLeft: 4, opacity: 0.6 }}>×</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add your own — staged flow */}
          {selectedCats.length < MAX_CATS && customKind === null && (
            <div
              onClick={() => setCustomKind("label")}
              style={{
                marginTop: 8, padding: "10px 6px",
                background: "rgba(255,255,255,0.38)",
                border: "1.5px dashed rgba(100,90,60,0.35)",
                borderRadius: 6, textAlign: "center", cursor: "pointer",
                fontSize: 10, fontWeight: "700", color: MUTED,
                letterSpacing: "0.05em", textTransform: "uppercase",
              }}
            >
              + Add your own
            </div>
          )}
          {customKind !== null && (
            <div style={{ marginTop: 10, padding: 10, background: "rgba(255,255,255,0.5)", borderRadius: 6 }}>
              {customKind === "label" ? (
                <>
                  <input
                    autoFocus
                    placeholder="e.g. Kids' activities"
                    value={customLabel}
                    onChange={e => setCustomLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && customLabel.trim()) setCustomKind("selecting"); if (e.key === "Escape") { setCustomKind(null); setCustomLabel(""); } }}
                    style={{ ...inputStyle, fontSize: 16, marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => { if (customLabel.trim()) setCustomKind("selecting"); }} disabled={!customLabel.trim()} style={{ ...btnPrimary(!customLabel.trim()), padding: "8px 14px", fontSize: 9 }}>Next →</button>
                    <button onClick={() => { setCustomKind(null); setCustomLabel(""); }} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>Cancel</button>
                  </div>
                </>
              ) : customKind === "selecting" ? (
                <>
                  <div style={{ fontSize: 9, color: MUTED, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>{customLabel} — what kind?</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {[
                      { kind: "recurring", label: "Recurring monthly" },
                      { kind: "savings",   label: "Saving toward it" },
                      { kind: "one_time",  label: "One-time cost" },
                      { kind: "property",  label: "Property requirement" },
                    ].map(({ kind, label }) => (
                      <div key={kind} onClick={() => {
                        if (kind === "one_time") {
                          const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: "one_time", monthly: null, propertyNeed: null };
                          setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                          setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN(""); return;
                        }
                        setCustomKind(kind);
                      }} style={{ padding: "9px 12px", background: "rgba(255,255,255,0.5)", border: "1.5px solid rgba(100,90,60,0.2)", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: "700", color: INK }}>
                        {label}
                      </div>
                    ))}
                    <button onClick={() => { setCustomKind("label"); setCustomAmount(""); setCustomPN(""); }} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>← Back</button>
                  </div>
                </>
              ) : customKind === "property" ? (
                <>
                  <div style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>What does {customLabel} need from the home?</div>
                  <input
                    autoFocus
                    placeholder="e.g. large yard, extra bedroom..."
                    value={customPropertyNeed}
                    onChange={e => setCustomPN(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && customPropertyNeed.trim()) {
                        const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: "property", monthly: null, propertyNeed: customPropertyNeed.trim() };
                        setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                        setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN("");
                      }
                      if (e.key === "Escape") setCustomKind("selecting");
                    }}
                    style={{ ...inputStyle, fontSize: 16, marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => {
                      if (!customPropertyNeed.trim()) return;
                      const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: "property", monthly: null, propertyNeed: customPropertyNeed.trim() };
                      setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                      setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN("");
                    }} disabled={!customPropertyNeed.trim()} style={{ ...btnPrimary(!customPropertyNeed.trim()), padding: "8px 14px", fontSize: 9 }}>Add</button>
                    <button onClick={() => setCustomKind("selecting")} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>← Back</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>{customKind === "savings" ? "Saving per month?" : "Monthly budget?"}</div>
                  <div style={{ position: "relative", marginBottom: 8 }}>
                    <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED }}>$</span>
                    <input
                      autoFocus
                      placeholder="350"
                      value={customAmount}
                      onChange={e => setCustomAmount(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && customAmount) {
                          const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: customKind, monthly: parseFloat(customAmount) || 0, propertyNeed: null };
                          setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                          setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN("");
                        }
                        if (e.key === "Escape") setCustomKind("selecting");
                      }}
                      type="number" inputMode="numeric"
                      style={{ ...inputStyle, paddingLeft: 22, fontSize: 16 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => {
                      if (!customAmount) return;
                      const newCat = { id: `custom_${Math.random().toString(36).slice(2, 8)}`, label: customLabel.trim(), custom: true, kind: customKind, monthly: parseFloat(customAmount) || 0, propertyNeed: null };
                      setSelected(prev => prev.length < MAX_CATS ? [...prev, newCat] : prev);
                      setCustomKind(null); setCustomLabel(""); setCustomAmount(""); setCustomPN("");
                    }} disabled={!customAmount} style={{ ...btnPrimary(!customAmount), padding: "8px 14px", fontSize: 9 }}>Add</button>
                    <button onClick={() => setCustomKind("selecting")} style={{ ...btnPrimary(false), padding: "8px 14px", fontSize: 9, background: "transparent", color: INK, border: "1.5px solid rgba(100,90,60,0.3)" }}>← Back</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <button
          style={btnPrimary(false)}
          onClick={() => onSave({
            income: parseFloat(income) || profile.income,
            essentialsTotal,
            essentials,
            downPct: parseFloat(downPct),
            cats: selectedCats,
          })}
        >
          Save Changes
        </button>

        <div
          onClick={() => { if (confirm("Start over? This will clear your profile.")) onStartOver(); }}
          style={{
            textAlign: "center", marginTop: 16, padding: "8px",
            fontSize: 10, color: MUTED, letterSpacing: "0.1em",
            textTransform: "uppercase", cursor: "pointer", textDecoration: "underline",
          }}
        >
          Start over
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [profile, setProfile]             = useState(loadProfile);
  const [screen, setScreen]               = useState(() => loadProfile() ? "address" : "welcome");
  const [property, setProperty]           = useState(null);
  const [useCount, setUseCount]           = useState(0);
  const [shareCount, setShareCount]       = useState(0);
  const [showPaywall, setShowPaywall]     = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [shareData, setShareData]         = useState(null);
  const [cachedSummary, setCachedSummary] = useState(null);
  const [cachedSummaryKey, setCachedSummaryKey] = useState(null);

  const handleOnboarding = (prof) => { setProfile(prof); saveProfile(prof); setScreen("address"); };

  const handleProfileSave = (prof) => { setProfile(prof); saveProfile(prof); setShowProfileEditor(false); };

  const handleCatAmountChange = (catId, newMonthly) => {
    setProfile(prev => {
      const updated = { ...prev, cats: prev.cats.map(c => c.id === catId ? { ...c, monthly: newMonthly } : c) };
      saveProfile(updated);
      return updated;
    });
  };

  const handleSearch = (prop) => {
    if (useCount >= 3) { setShowPaywall(true); return; }
    setProperty(prop);
    setUseCount(c => c + 1);
    setScreen("map");
  };

  const handleShare = (data) => {
    const key = JSON.stringify({
      address: data.property.address,
      housingPct: data.housingPct.toFixed(1),
      rate: data.rate,
      downPct: data.downPct,
      tiles: data.tiles.map(t => t.id + ":" + Math.round(t.value)),
    });
    if (key !== cachedSummaryKey) {
      if (shareCount >= 3) { setShowPaywall(true); return; }
      setCachedSummary(null);
      setCachedSummaryKey(key);
      setShareCount(c => c + 1);
    }
    setShareData(data);
    setScreen("share");
  };

  return (
    <div style={{
      background: BG,
      height: "100%",
      overflow: "hidden",
      display: "flex", flexDirection: "column", alignItems: "stretch",
      fontFamily: font,
      boxSizing: "border-box",
      userSelect: "none", WebkitUserSelect: "none",
      overscrollBehavior: "none",
    }}>
      {showPaywall && <PaywallOverlay onClose={() => setShowPaywall(false)} />}
      {showProfileEditor && profile && (
        <ProfileEditorOverlay
          profile={profile}
          onSave={handleProfileSave}
          onClose={() => setShowProfileEditor(false)}
          onStartOver={() => { clearProfile(); setProfile(null); setShowProfileEditor(false); setScreen("onboarding"); }}
        />
      )}

      {screen === "welcome"    && <WelcomeScreen onContinue={() => setScreen("onboarding")} />}
      {screen === "onboarding" && <OnboardingScreen onDone={handleOnboarding} />}
      {screen === "address"    && <AddressScreen usesLeft={3 - useCount} onSearch={handleSearch} onEditProfile={() => setShowProfileEditor(true)} />}
      {screen === "map"        && <MapScreen property={property} profile={profile} shareCount={shareCount} onBack={() => setScreen("address")} onShare={handleShare} onCatAmountChange={handleCatAmountChange} onEditProfile={() => setShowProfileEditor(true)} />}
      {screen === "share"      && <ShareScreen data={shareData} profile={profile} cachedSummary={cachedSummary} onSummaryReady={setCachedSummary} onClose={() => setScreen("map")} />}
    </div>
  );
}
