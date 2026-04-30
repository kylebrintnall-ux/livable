import { useState, useRef, useCallback, useEffect } from "react";

// ── Brand ──────────────────────────────────────────────────────────────────
const BG       = "#cdd4b0";
const CREAM    = "#faf5e8";
const INK      = "#1e1a0e";
const MUTED    = "#7a6a44";
const HOUSING_COLOR = "#C8412A";
const NEEDS_COLOR   = "#5a4e8a";
const CAT_COLORS    = ["#3B7FC4","#4A9B6F","#E8A030","#D4505A","#3A9EA5","#C4963B","#7B5EA7","#D97B3A"];

const MOBILE_MAX = 430;

// ── Taper curve for stack-ranked tiles ────────────────────────────────────
const TAPER = [0.30, 0.22, 0.17, 0.13, 0.10, 0.08];
function taperWeights(n) {
  const w = TAPER.slice(0, n);
  const sum = w.reduce((s, v) => s + v, 0);
  return w.map(v => v / sum);
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

// ── Affordability signal ───────────────────────────────────────────────────
function getSignal(pct) {
  if (pct <= 28) return { label: "Fits Your Life",  color: "#4A9B6F" };
  if (pct <= 35) return { label: "Manageable",       color: "#E8A030" };
  if (pct <= 45) return { label: "Stretched",        color: "#D97B3A" };
  return               { label: "Hard to Sustain",  color: "#C8412A" };
}

// ── Treemap layout ─────────────────────────────────────────────────────────
function computeRects(tiles, W, H, gap) {
  if (!tiles.length) return [];
  const g = gap;
  const total = tiles.reduce((s, t) => s + t.value, 0);
  const housing = tiles.find(t => t.id === "housing");
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
    row.forEach(tile => {
      const w = (tile.value / rowTotals[ri]) * (rightW - (row.length - 1) * g);
      rects.push({ id: tile.id, x: rx, y: ry, w, h: rowH });
      rx += w + g;
    });
    ry += rowH + g;
  });
  return rects;
}

// ── Category options ───────────────────────────────────────────────────────
const CATS = [
  { id: "travel",        label: "Travel"        },
  { id: "dining",        label: "Dining"        },
  { id: "hobbies",       label: "Hobbies"       },
  { id: "social",        label: "Social"        },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "pets",          label: "Pets"          },
  { id: "fitness",       label: "Fitness"       },
  { id: "style",         label: "Style"         },
  { id: "giving",        label: "Giving"        },
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
  const { address, price, monthlyHousing, income, housingPct, signal, cats, downPct, rate } = data;
  const catList = cats.map((c, i) => `${i+1}. ${c.label} (${c.pct.toFixed(0)}% of budget, $${Math.round(c.monthly)}/mo)`).join(", ");

  const prompt = `You are writing a concise financial lifestyle summary for a home affordability app called LIVABLE.

Property: ${address} — $${price.toLocaleString()} list price
Monthly housing cost: $${Math.round(monthlyHousing).toLocaleString()} (${housingPct.toFixed(0)}% of take-home)
Down payment: ${downPct}% | Rate: ${rate}%
Monthly take-home: $${income.toLocaleString()}
Affordability signal: ${signal.label}
Lifestyle priorities in order: ${catList}

Write exactly THREE short paragraphs with these headers:
**The Numbers** — pure math: what the house costs monthly, what's left, whether PMI applies.
**Your Life** — what this house means for their specific top 2-3 values. Be direct and personal.
**The Verdict** — one plain-English recommendation. Don't hedge. Tell them clearly if this fits or doesn't.

Tone: warm, honest, direct. Like a smart friend who knows finance. Max 60 words per paragraph. No bullet points.`;

  try {
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const json = await res.json();
    return json.text || "";
  } catch {
    return "Unable to generate summary. Please try again.";
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

// ── Screen: Onboarding ────────────────────────────────────────────────────
function OnboardingScreen({ onDone, shareCount, useCount }) {
  const [income, setIncome]       = useState("");
  const [needs, setNeeds]         = useState("");
  const [downPct, setDownPct]     = useState("10");
  const [selectedCats, setSelected] = useState([]);
  const MAX_CATS = 5;

  const toggleCat = (id) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : prev.length < MAX_CATS ? [...prev, id] : prev
    );
  };

  const canProceed = income && needs && selectedCats.length >= 1;

  return (
    <div style={{ width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto" }}>
      {/* Wordmark */}
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 26, fontWeight: "800", color: INK, letterSpacing: "-0.03em" }}>LIVABLE</div>
        <div style={{ fontSize: 9, letterSpacing: "0.26em", color: MUTED, textTransform: "uppercase", marginTop: 2 }}>
          Does this home fit your life?
        </div>
      </div>

      {/* Free tier notice — compact single line */}
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
          <input style={{ ...inputStyle, paddingLeft: 24 }} placeholder="e.g. 7500" value={income} onChange={e => setIncome(e.target.value)} type="number" />
        </div>
      </div>

      {/* Basic needs */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
          Monthly essentials — savings, healthcare, education, groceries, utilities, transport
        </div>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13 }}>$</span>
          <input style={{ ...inputStyle, paddingLeft: 24 }} placeholder="e.g. 2400" value={needs} onChange={e => setNeeds(e.target.value)} type="number" />
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
            const rank = selectedCats.indexOf(cat.id);
            const selected = rank !== -1;
            const atLimit = selectedCats.length >= MAX_CATS && !selected;
            return (
              <div
                key={cat.id}
                onClick={() => toggleCat(cat.id)}
                style={{
                  background: selected ? `${CAT_COLORS[rank % CAT_COLORS.length]}22` : "rgba(255,255,255,0.38)",
                  border: `1.5px solid ${selected ? CAT_COLORS[rank % CAT_COLORS.length] : "rgba(100,90,60,0.18)"}`,
                  borderRadius: 5, padding: "8px 6px",
                  cursor: atLimit ? "default" : "pointer",
                  opacity: atLimit ? 0.38 : 1,
                  textAlign: "center", position: "relative",
                  transition: "all 0.12s",
                }}
              >
                <div style={{ fontSize: 10, fontWeight: "700", color: INK, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1.2 }}>{cat.label}</div>
                {selected && (
                  <div style={{ fontSize: 8, fontWeight: "800", color: CAT_COLORS[rank % CAT_COLORS.length], marginTop: 1 }}>{rank + 1}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button
        style={btnPrimary(!canProceed)}
        onClick={() => canProceed && onDone({ income: parseFloat(income), needs: parseFloat(needs), downPct: parseFloat(downPct), cats: selectedCats })}
      >
        Start Using Livable →
      </button>
    </div>
  );
}

// ── Screen: Address Entry ─────────────────────────────────────────────────
function AddressScreen({ usesLeft, onSearch, profile }) {
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
    <div style={{ width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontSize: 34, fontWeight: "800", color: INK, letterSpacing: "-0.03em" }}>LIVABLE</div>
        <div style={{ fontSize: 10, letterSpacing: "0.28em", color: MUTED, textTransform: "uppercase", marginTop: 3 }}>
          Does this home fit your life?
        </div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.45)", borderRadius: 8, padding: "24px 20px", marginBottom: 16, boxShadow: "0 2px 16px rgba(0,0,0,0.07)" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 8 }}>
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
        <button
          style={{ ...btnPrimary(loading || !address.trim()), marginTop: 12 }}
          onClick={handleGo}
        >
          {loading ? "Looking up property…" : "See If It Fits →"}
        </button>
      </div>

      {/* Usage counter */}
      <div style={{ textAlign: "center", fontSize: 10, color: MUTED, letterSpacing: "0.08em" }}>
        {usesLeft > 0
          ? `${3 - usesLeft} of 3 free looks used`
          : "3 of 3 free looks used"}
      </div>

      {/* Profile summary */}
      <div style={{ marginTop: 24, padding: "14px 16px", background: "rgba(255,255,255,0.3)", borderRadius: 6 }}>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 8 }}>Your Profile</div>
        <div style={{ fontSize: 11, color: INK, lineHeight: 1.7 }}>
          <span style={{ color: MUTED }}>Take-home</span> ${profile.income.toLocaleString()}/mo ·{" "}
          <span style={{ color: MUTED }}>Essentials</span> ${profile.needs.toLocaleString()}/mo ·{" "}
          <span style={{ color: MUTED }}>Down</span> {profile.downPct}%
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
          {profile.cats.map((id, i) => {
            const cat = CATS.find(c => c.id === id);
            return (
              <div key={id} style={{
                fontSize: 9, padding: "3px 8px",
                background: `${CAT_COLORS[i % CAT_COLORS.length]}22`,
                border: `1px solid ${CAT_COLORS[i % CAT_COLORS.length]}`,
                borderRadius: 10, color: CAT_COLORS[i % CAT_COLORS.length],
                fontWeight: "600", letterSpacing: "0.06em",
              }}>
                {i + 1} {cat?.label}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10, fontSize: 9, color: MUTED, cursor: "pointer", letterSpacing: "0.1em", textDecoration: "underline" }}
          onClick={() => window.location.reload()}>
          Edit profile
        </div>
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
function MapScreen({ property, profile, useCount, shareCount, onBack, onShare }) {
  const [rate, setRate]       = useState(CURRENT_RATE);
  const [downPct, setDownPct] = useState(profile.downPct);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [tiles, setTiles]     = useState([]);
  const [dims, setDims]       = useState({ w: 600, h: 300 });
  const [draggingEdge, setDraggingEdge] = useState(null);
  const [hoveredEdge, setHoveredEdge]   = useState(null);
  const [activeSlider, setActiveSlider] = useState(null);
  const [longPressTimer, setLongPressTimer] = useState(null);
  const [photoExpanded, setPhotoExpanded] = useState(false);
  const containerRef = useRef(null);
  const dragRef      = useRef(null);
  const rafRef       = useRef(null);
  const GAP = 3;

  const inc = profile.income;

  // Build tiles
  useEffect(() => {
    const payment = monthlyPayment(property.price, downPct, rate);
    const pmi = pmiMonthly(property.price, downPct);
    const taxes = Math.round(property.price * 0.012 / 12);
    const insurance = Math.round(property.price * 0.005 / 12);
    const housingMonthly = payment + pmi + taxes + insurance;

    const remaining = inc - housingMonthly - profile.needs;
    const lifestylePool = Math.max(remaining, 100);
    const weights = taperWeights(profile.cats.length);

    const catTiles = profile.cats.map((id, i) => {
      const cat = CATS.find(c => c.id === id);
      return {
        id, label: cat.label,
        value: Math.max(lifestylePool * weights[i], inc * 0.03),
        color: CAT_COLORS[i % CAT_COLORS.length],
        locked: false,
      };
    });

    const rawNonHousing = [
      { id: "needs", label: "Essentials", value: Math.max(profile.needs, inc * 0.03), locked: false, color: NEEDS_COLOR },
      ...catTiles,
    ];
    const rawSum = rawNonHousing.reduce((s, t) => s + t.value, 0);
    const targetSum = inc - housingMonthly;
    const scale = targetSum > 0 && rawSum > 0 ? targetSum / rawSum : 1;

    setTiles([
      { id: "housing", label: "Housing", value: housingMonthly, locked: true, color: HOUSING_COLOR },
      ...rawNonHousing.map(t => ({ ...t, value: Math.max(t.value * scale, inc * 0.025) })),
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

  const housingTile = tiles.find(t => t.id === "housing");
  const housingPct  = housingTile ? (housingTile.value / inc) * 100 : 0;
  const signal      = getSignal(housingPct);
  const rects       = computeRects(tiles, dims.w, dims.h, GAP);

  // Edge defs derived from tiles
  const edgeDefs = useCallback(() => {
    const nonH = tiles.filter(t => t.id !== "housing");
    if (!nonH.length) return [];
    const ROW_SIZE = 3;
    const rows = [];
    for (let i = 0; i < nonH.length; i += ROW_SIZE) rows.push(nonH.slice(i, i + ROW_SIZE));
    const defs = [];
    rows.forEach((row, ri) => {
      for (let ci = 0; ci < row.length - 1; ci++) {
        defs.push({
          id: `R${ri}C${ci}`, orientation: "vertical",
          groupA: row.slice(0, ci + 1).map(t => t.id),
          groupB: row.slice(ci + 1).map(t => t.id),
        });
      }
    });
    for (let ri = 0; ri < rows.length - 1; ri++) {
      defs.push({
        id: `ROW${ri}`, orientation: "horizontal",
        groupA: rows.slice(0, ri + 1).flat().map(t => t.id),
        groupB: rows.slice(ri + 1).flat().map(t => t.id),
      });
    }
    return defs;
  }, [tiles])();

  const startEdgeDrag = useCallback((e, def) => {
    e.preventDefault(); e.stopPropagation();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const getVal = id => tiles.find(t => t.id === id)?.value || 0;
    const aTotal = def.groupA.reduce((s, id) => s + getVal(id), 0);
    const bTotal = def.groupB.reduce((s, id) => s + getVal(id), 0);
    dragRef.current = { def, startX: cx, startY: cy, aTotal, bTotal, snapData: [...tiles] };
    setDraggingEdge(def.id);
  }, [tiles]);

  const moveEdge = useCallback((cx, cy) => {
    if (!dragRef.current) return;
    const { def, startX, startY, aTotal, bTotal, snapData } = dragRef.current;
    const delta = def.orientation === "vertical" ? cx - startX : cy - startY;
    const span  = def.orientation === "vertical" ? dims.w : dims.h;
    const transfer = (delta / span) * (aTotal + bTotal);
    setTiles(prev => prev.map(t => {
      if (t.locked) return t;
      if (def.groupA.includes(t.id)) {
        const orig = snapData.find(s => s.id === t.id)?.value || t.value;
        return { ...t, value: Math.max(8, orig + transfer * (orig / aTotal)) };
      }
      if (def.groupB.includes(t.id)) {
        const orig = snapData.find(s => s.id === t.id)?.value || t.value;
        return { ...t, value: Math.max(8, orig - transfer * (orig / bTotal)) };
      }
      return t;
    }));
  }, [dims]);

  useEffect(() => {
    if (!draggingEdge) return;
    const onMove = e => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => moveEdge(cx, cy));
    };
    const onUp = () => { setDraggingEdge(null); dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [draggingEdge, moveEdge]);

  const startLongPress = useCallback((e, id) => {
    if (e.touches?.length > 1) return;
    const tile = tiles.find(t => t.id === id);
    if (tile?.locked) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const timer = setTimeout(() => {
      const bRect = containerRef.current?.getBoundingClientRect();
      setActiveSlider({ id, x: cx - (bRect?.left || 0), y: cy - (bRect?.top || 0) });
    }, 500);
    setLongPressTimer(timer);
  }, [tiles]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer) { clearTimeout(longPressTimer); setLongPressTimer(null); }
  }, [longPressTimer]);

  const adjustSlider = useCallback((id, newPct) => {
    setTiles(prev => {
      const nonLockedTotal = prev.filter(t => !t.locked && t.id !== id).reduce((s, t) => s + t.value, 0);
      const currentPct = (prev.find(t => t.id === id)?.value / inc) * 100;
      const diff = ((newPct - currentPct) / 100) * inc;
      return prev.map(t => {
        if (t.id === id) return { ...t, value: Math.max(8, t.value + diff) };
        if (!t.locked && nonLockedTotal > 0) return { ...t, value: Math.max(8, t.value - (t.value / nonLockedTotal) * diff) };
        return t;
      });
    });
  }, [inc]);

  const getEdgePos = (def) => {
    const rm = Object.fromEntries(rects.map(r => [r.id, r]));
    if (def.id.startsWith("ROW")) {
      const lastId = def.groupA[def.groupA.length - 1];
      const r = rm[lastId];
      if (!r) return null;
      const housingR = rm["housing"];
      return { x: housingR ? housingR.w + GAP : 0, y: r.y + r.h, orientation: "horizontal", lenW: true };
    }
    const lastId = def.groupA[def.groupA.length - 1];
    const r = rm[lastId];
    if (!r) return null;
    return { x: r.x + r.w, y: r.y, orientation: "vertical", lenH: r.h };
  };

  const HANDLE_V = 18;
  const HANDLE_H = 48;
  const housingR = rects.find(r => r.id === "housing");
  const rightX   = housingR ? housingR.w + GAP : 0;
  const rightW   = dims.w - rightX;

  // Dynamic verdict
  const getVerdict = () => {
    if (housingPct <= 28) return { text: `This home fits your life. Housing takes ${housingPct.toFixed(0)}% — your lifestyle budget stays healthy.`, color: "#4A9B6F" };
    if (housingPct <= 35) return { text: `Manageable but tight at ${housingPct.toFixed(0)}%. Adjust the tiles to see what you'd trim.`, color: "#E8A030" };
    if (housingPct <= 45) return { text: `Reshapes your lifestyle. At ${housingPct.toFixed(0)}%, something has to give — drag tiles to see what.`, color: "#D97B3A" };
    return { text: `Hard to sustain. Housing eats ${housingPct.toFixed(0)}% — this works against your life.`, color: "#C8412A" };
  };
  const verdict = getVerdict();

  const streetViewUrl = `/api/streetview?address=${encodeURIComponent(property.address)}`;

  return (
    <div style={{
      width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto",
      display: "flex", flexDirection: "column",
      height: "100dvh",
      padding: "8px 14px env(safe-area-inset-bottom, 8px)",
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

      {/* Property photo card — 110px, no FOR SALE label */}
      <div
        onClick={() => setPhotoExpanded(true)}
        style={{
          borderRadius: 6, overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
          position: "relative", height: 110, background: INK,
          cursor: "pointer", flexShrink: 0,
        }}
      >
        <img src={streetViewUrl} alt={property.address} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(18,16,8,0.97) 0%, rgba(18,16,8,0.15) 60%, transparent 100%)",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
          padding: "0 14px 10px",
        }}>
          <div style={{ fontSize: 13, fontWeight: "800", color: CREAM, letterSpacing: "-0.01em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.2 }}>
            {property.address}
          </div>
          <div style={{ fontSize: 9, color: "rgba(250,245,232,0.5)", marginTop: 3, letterSpacing: "0.04em" }}>
            ${property.price.toLocaleString()} &nbsp;·&nbsp; {property.beds}bd &nbsp;·&nbsp; {property.baths}ba &nbsp;·&nbsp; {property.sqft.toLocaleString()}sf &nbsp;·&nbsp; {property.yearBuilt}
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
            ${Math.round(housingTile?.value || 0).toLocaleString()}<span style={{ fontSize: 9, fontWeight: "400", opacity: 0.5 }}>/mo</span>
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

      {/* Treemap — fills remaining space */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: "relative", borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,0.14)",
          touchAction: "none", overscrollBehavior: "none",
        }}
      >
        {rects.map(rect => {
          const tile = tiles.find(t => t.id === rect.id);
          if (!tile) return null;
          const pct = (tile.value / inc) * 100;
          const pad = rect.w < 50 ? 5 : 10;

          // Label sizing uses both dimensions; fall back to vertical only at min readable size
          const labelSizeRaw = Math.min(rect.w / 9, rect.h / 11, 10);
          const labelSize = Math.max(7, labelSizeRaw);
          const labelClips = (tile.label.length * labelSize * 0.65) > (rect.w - pad * 2);
          const useVertical = labelClips && labelSizeRaw <= 7 && rect.h > 55;

          const pctSize = Math.max(10, Math.min(28, Math.min(rect.w / 3.8, rect.h / 3.2)));
          const moSize  = Math.max(6, Math.min(10, rect.w / 9));
          const showMo  = rect.h > (labelSize + pctSize + moSize + 18);

          const vLabelSize = Math.max(7, Math.min(9, rect.w / 5));
          const vPctSize   = Math.max(9, Math.min(18, rect.w / 3.5));

          return (
            <div
              key={rect.id}
              onMouseDown={e => startLongPress(e, rect.id)}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={e => { e.stopPropagation(); startLongPress(e, rect.id); }}
              onTouchEnd={e => { e.stopPropagation(); cancelLongPress(); }}
              onTouchMove={e => e.stopPropagation()}
              style={{
                position: "absolute",
                left: rect.x, top: rect.y,
                width: Math.max(0, rect.w), height: Math.max(0, rect.h),
                background: tile.color,
                borderRadius: 8,
                transition: draggingEdge ? "none" : "left 0.18s ease, top 0.18s ease, width 0.18s ease, height 0.18s ease",
                overflow: "hidden", touchAction: "none",
                cursor: tile.locked ? "default" : "grab",
              }}
            >
              {tile.locked && rect.w > 60 && !useVertical && (
                <div style={{ position: "absolute", top: 5, right: 7, fontSize: 7, letterSpacing: "0.12em", color: "rgba(252,246,224,0.45)", textTransform: "uppercase" }}>FIXED</div>
              )}

              {useVertical ? (
                // Label on left (vertical-lr), percentage centered in remaining space — no collision
                <div style={{ position: "absolute", inset: 0, display: "flex", padding: `${pad}px` }}>
                  <div style={{
                    writingMode: "vertical-lr",
                    fontSize: vLabelSize, fontWeight: "700",
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    color: "rgba(252,246,224,0.75)",
                    overflow: "hidden", marginRight: 3, flexShrink: 0,
                    textShadow: "0 1px 3px rgba(0,0,0,0.35)",
                  }}>
                    {tile.label}
                  </div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ fontSize: vPctSize, fontWeight: "800", color: "rgba(252,246,224,0.96)", lineHeight: 1, textShadow: "0 1px 3px rgba(0,0,0,0.35)" }}>
                      {pct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ position: "absolute", top: pad, left: pad, right: pad, color: "rgba(252,246,224,0.96)", textShadow: "0 1px 3px rgba(0,0,0,0.35)", overflow: "hidden" }}>
                  <div style={{ fontSize: labelSize, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: "600", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.82 }}>
                    {tile.label}
                  </div>
                  <div style={{ fontSize: pctSize, fontWeight: "800", lineHeight: 1, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
                    {pct.toFixed(0)}%
                  </div>
                  {showMo && (
                    <div style={{ fontSize: moSize, opacity: 0.65, marginTop: 3, whiteSpace: "nowrap" }}>
                      ${Math.round(tile.value).toLocaleString()}/mo
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Edge handles */}
        {edgeDefs.map(def => {
          const pos = getEdgePos(def);
          if (!pos) return null;
          const isV = pos.orientation === "vertical";
          const isActive = draggingEdge === def.id;
          const isHovered = hoveredEdge === def.id;
          const rm = Object.fromEntries(rects.map(r => [r.id, r]));
          const lastId = def.groupA[def.groupA.length - 1];
          const refRect = rm[lastId];
          const len = pos.lenW ? rightW : (refRect?.h || 100);

          return (
            <div
              key={def.id}
              onMouseDown={e => startEdgeDrag(e, def)}
              onTouchStart={e => { e.preventDefault(); e.stopPropagation(); startEdgeDrag(e, def); }}
              onMouseEnter={() => setHoveredEdge(def.id)}
              onMouseLeave={() => setHoveredEdge(null)}
              style={{
                position: "absolute",
                left: isV ? pos.x - HANDLE_V / 2 : pos.x,
                top:  isV ? pos.y               : pos.y - HANDLE_H / 2,
                width:  isV ? HANDLE_V : len,
                height: isV ? len      : HANDLE_H,
                cursor: isV ? "col-resize" : "row-resize",
                zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <div style={{
                background: isActive ? "rgba(252,246,224,0.9)" : isHovered ? "rgba(252,246,224,0.55)" : "rgba(252,246,224,0.18)",
                borderRadius: 3,
                width: isV ? 3 : "100%", height: isV ? "100%" : 3,
                pointerEvents: "none", transition: "background 0.15s",
              }} />
              {!isV && (
                <div style={{ position: "absolute", background: isActive ? "rgba(252,246,224,0.98)" : "rgba(252,246,224,0.6)", borderRadius: 6, width: 40, height: 6, pointerEvents: "none" }} />
              )}
              {isV && (isHovered || isActive) && (
                <div style={{ position: "absolute", display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none" }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(252,246,224,0.9)" }} />)}
                </div>
              )}
            </div>
          );
        })}

        {/* Slider popup */}
        {activeSlider && (() => {
          const tile = tiles.find(t => t.id === activeSlider.id);
          if (!tile || tile.locked) return null;
          const pct = (tile.value / inc) * 100;
          const popW = 220, popH = 88;
          const px = Math.min(dims.w - popW - 8, Math.max(8, activeSlider.x - popW / 2));
          const py = Math.min(dims.h - popH - 8, Math.max(8, activeSlider.y - popH - 12));
          return (
            <>
              <div style={{ position: "absolute", inset: 0, zIndex: 45 }}
                onMouseDown={() => setActiveSlider(null)}
                onTouchStart={e => { e.stopPropagation(); setActiveSlider(null); }}
              />
              <div onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}
                style={{
                  position: "absolute", left: px, top: py, width: popW, zIndex: 50,
                  padding: "12px 14px", background: "rgba(22,18,10,0.96)",
                  border: `1px solid ${tile.color}55`, borderRadius: 4,
                  boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "rgba(252,246,224,0.5)", letterSpacing: "0.16em", textTransform: "uppercase" }}>{tile.label}</div>
                    <div style={{ marginTop: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: "700", color: tile.color }}>{pct.toFixed(1)}%</span>
                      <span style={{ fontSize: 9, color: "rgba(252,246,224,0.4)", marginLeft: 8 }}>${Math.round(tile.value).toLocaleString()}/mo</span>
                    </div>
                  </div>
                  <div onMouseDown={() => setActiveSlider(null)} onTouchStart={e => { e.stopPropagation(); setActiveSlider(null); }}
                    style={{ fontSize: 20, color: "rgba(252,246,224,0.35)", cursor: "pointer", padding: "2px 4px" }}>×</div>
                </div>
                <input type="range" min={0.5} max={40} step={0.5} value={pct}
                  onChange={e => adjustSlider(activeSlider.id, parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: tile.color, cursor: "pointer" }}
                />
              </div>
            </>
          );
        })()}
      </div>

      {/* Live verdict — single line, no % subtitle in badge */}
      <div style={{
        padding: "8px 10px", borderRadius: 6,
        background: `${verdict.color}14`,
        border: `1.5px solid ${verdict.color}55`,
        display: "flex", alignItems: "center", gap: 8,
        flexShrink: 0,
      }}>
        <div style={{ flexShrink: 0, background: verdict.color, borderRadius: 3, padding: "3px 8px" }}>
          <div style={{ fontSize: 9, fontWeight: "800", color: CREAM, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            {signal.label}
          </div>
        </div>
        <div style={{ fontSize: 11, color: INK, lineHeight: 1.4, minWidth: 0, flex: 1 }}>{verdict.text}</div>
      </div>

      {/* Actions — marginTop auto pins to bottom of flex column */}
      <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
        <button
          style={{ ...btnPrimary(false), background: "transparent", color: INK, border: `1.5px solid rgba(100,90,60,0.3)`, width: "auto", padding: "10px 16px", fontSize: 9 }}
          onClick={onBack}
        >← New</button>
        <button
          style={{ ...btnPrimary(false), background: "#C8412A", flex: 1 }}
          onClick={() => onShare({ tiles, property, signal, housingPct, rate, downPct })}
        >
          Share This Map ↗{shareCount < 3 ? ` · ${3 - shareCount} free` : ""}
        </button>
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
  const { tiles, property, signal, housingPct, rate, downPct } = data;
  const inc = profile.income;

  useEffect(() => {
    if (cachedSummary) { setSummary(cachedSummary); setLoading(false); setRevealed(true); return; }
    const catTiles = tiles.filter(t => t.id !== "housing" && t.id !== "needs");
    generateSummary({
      address: property.address,
      price: property.price,
      monthlyHousing: tiles.find(t => t.id === "housing")?.value || 0,
      income: inc,
      housingPct,
      signal,
      cats: catTiles.map(t => ({ label: t.label, pct: (t.value / inc) * 100, monthly: t.value })),
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

  const paragraphs = summary ? summary.split("\n\n").filter(Boolean) : [];

  const SVG_W = 480, SVG_H = 200, SVG_GAP = 3;
  const shareRects = computeRects(tiles, SVG_W, SVG_H, SVG_GAP);

  return (
    <div style={{ width: "100%", maxWidth: MOBILE_MAX, margin: "0 auto" }}>
      <div id="livable-export-card" style={{
        background: CREAM, borderRadius: 8,
        boxShadow: "0 8px 40px rgba(0,0,0,0.15)",
        overflow: "hidden",
      }}>
        <div style={{ background: INK, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: "800", color: CREAM, letterSpacing: "-0.02em" }}>LIVABLE</div>
            <div style={{ fontSize: 8, letterSpacing: "0.22em", color: "rgba(250,245,232,0.5)", textTransform: "uppercase" }}>Home · Budget · Life</div>
          </div>
          <div style={{ background: signal.color, borderRadius: 4, padding: "6px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: "700", color: CREAM, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {signal.label}
            </div>
            <div style={{ fontSize: 8, color: "rgba(252,246,224,0.7)", marginTop: 1 }}>{housingPct.toFixed(0)}% of income</div>
          </div>
        </div>

        <div style={{ padding: "16px 20px 20px" }}>

          <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid rgba(0,0,0,0.08)` }}>
            <div style={{ fontSize: 13, fontWeight: "700", color: INK }}>{property.address}</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
              ${property.price.toLocaleString()} &nbsp;·&nbsp; {property.beds}bd {property.baths}ba &nbsp;·&nbsp; ${Math.round(tiles.find(t=>t.id==="housing")?.value||0).toLocaleString()}/mo &nbsp;·&nbsp; {rate}% &nbsp;·&nbsp; {downPct}% down
            </div>
          </div>

          <div style={{ marginBottom: 14, borderRadius: 4, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.1)" }}>
            <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
              {shareRects.map(rect => {
                const tile = tiles.find(t => t.id === rect.id);
                if (!tile) return null;
                const pct = (tile.value / inc) * 100;
                const pad = 5;
                const avail = rect.w - pad * 2;

                const labelSize = Math.max(5, Math.min(8, avail / (tile.label.length * 0.65)));
                const pctSize   = Math.max(7, Math.min(18, avail / 3.2));
                const moSize    = Math.max(5, Math.min(7, avail / 7));
                const moText    = `$${Math.round(tile.value).toLocaleString()}/mo`;

                const useVert = avail < 38 && rect.h > 50;
                const stackH  = labelSize + 3 + pctSize + 3 + moSize;
                const fitsH   = stackH < rect.h - pad * 2;

                if (!fitsH && !useVert) {
                  return (
                    <g key={rect.id}>
                      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={tile.color} rx={6} />
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
                      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={tile.color} rx={6} />
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
                    <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={tile.color} rx={6} />
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
            {loading ? <HouseLoader done={done} /> : revealed ? (
              <div style={{
                animation: cachedSummary ? "none" : "livable-reveal 0.6s cubic-bezier(0.16,1,0.3,1) both",
                overflow: "hidden",
              }}>
                {paragraphs.map((p, i) => {
                const boldMatch = p.match(/^\*\*(.+?)\*\*\s*[—–-]?\s*([\s\S]*)/);
                if (boldMatch) {
                  return (
                    <div key={i} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: "800", color: INK, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                        {boldMatch[1]}
                      </div>
                      <div style={{ fontSize: 11, color: INK, lineHeight: 1.65 }}>
                        {boldMatch[2]}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} style={{ marginBottom: 12, fontSize: 11, color: INK, lineHeight: 1.65 }}>
                    {p.replace(/\*\*/g, "")}
                  </div>
                );
              })}
              </div>
            ) : null}
          </div>

          {/* Budget breakdown table */}
          <div style={{ paddingTop: 12, borderTop: `1px solid rgba(0,0,0,0.08)` }}>
            <div style={{ fontSize: 8, letterSpacing: "0.2em", color: MUTED, textTransform: "uppercase", marginBottom: 8 }}>
              Monthly Breakdown · ${inc.toLocaleString()} take-home
            </div>
            {tiles.map(t => {
              const pct = (t.value / inc) * 100;
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, background: t.color, borderRadius: 2, flexShrink: 0 }} />
                  <div style={{ fontSize: 10, color: INK, flex: 1 }}>{t.label}{t.locked ? " — Fixed" : ""}</div>
                  <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace" }}>{pct.toFixed(1)}%</div>
                  <div style={{ fontSize: 10, fontWeight: "700", color: INK, fontFamily: "monospace" }}>${Math.round(t.value).toLocaleString()}/mo</div>
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
          onClick={() => {
            const styleId = "livable-print-style";
            if (!document.getElementById(styleId)) {
              const style = document.createElement("style");
              style.id = styleId;
              style.innerHTML = `
                @media print {
                  body > * { display: none !important; }
                  #livable-export-card { display: block !important; }
                  #livable-export-card { position: fixed; top: 0; left: 0; width: 100%; }
                  @page { margin: 0.5in; size: letter portrait; }
                }
              `;
              document.head.appendChild(style);
            }
            const card = document.getElementById("livable-export-card");
            if (card) card.style.display = "block";
            window.print();
          }}
        >
          Export as PDF ↓
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen]     = useState("onboarding");
  const [profile, setProfile]   = useState(null);
  const [property, setProperty] = useState(null);
  const [useCount, setUseCount] = useState(0);
  const [shareCount, setShareCount] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);
  const [shareData, setShareData]   = useState(null);
  const [cachedSummary, setCachedSummary] = useState(null);
  const [cachedSummaryKey, setCachedSummaryKey] = useState(null);

  const handleOnboarding = (prof) => { setProfile(prof); setScreen("address"); };

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

  const isMap = screen === "map";
  return (
    <div style={{
      background: BG,
      ...(isMap
        ? { height: "100dvh", overflow: "hidden", padding: 0 }
        : { minHeight: "100dvh", padding: "16px 14px 32px" }
      ),
      display: "flex", flexDirection: "column", alignItems: "stretch",
      fontFamily: font,
      boxSizing: "border-box",
      userSelect: "none", WebkitUserSelect: "none",
      overscrollBehavior: "none",
    }}>
      {showPaywall && <PaywallOverlay onClose={() => setShowPaywall(false)} />}

      {screen === "onboarding" && <OnboardingScreen onDone={handleOnboarding} shareCount={shareCount} useCount={useCount} />}
      {screen === "address"    && <AddressScreen usesLeft={3 - useCount} onSearch={handleSearch} profile={profile} />}
      {screen === "map"        && <MapScreen property={property} profile={profile} useCount={useCount} shareCount={shareCount} onBack={() => setScreen("address")} onShare={handleShare} />}
      {screen === "share"      && <ShareScreen data={shareData} profile={profile} cachedSummary={cachedSummary} onSummaryReady={setCachedSummary} onClose={() => setScreen("map")} />}
    </div>
  );
}
