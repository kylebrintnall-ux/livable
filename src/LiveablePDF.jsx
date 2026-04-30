import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";

const INK  = "#1e1a0e";
const CREAM = "#faf5e8";
const MUTED = "#7a6a44";
const BG    = "#cdd4b0";

const s = StyleSheet.create({
  page:        { padding: 40, backgroundColor: CREAM, fontFamily: "Helvetica" },
  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.1)" },
  brand:       { fontSize: 22, fontWeight: "bold", color: INK },
  tagline:     { fontSize: 7, color: MUTED, marginTop: 3, letterSpacing: 1.5 },
  badge:       { borderRadius: 4, paddingVertical: 5, paddingHorizontal: 11 },
  badgeLabel:  { fontSize: 9, fontWeight: "bold", color: CREAM, letterSpacing: 0.8 },
  badgePct:    { fontSize: 7, color: "rgba(250,245,232,0.8)", marginTop: 1 },
  address:     { fontSize: 14, fontWeight: "bold", color: INK, marginBottom: 3 },
  meta:        { fontSize: 9, color: MUTED, marginBottom: 18 },
  secLabel:    { fontSize: 7, letterSpacing: 1.8, color: MUTED, textTransform: "uppercase", marginBottom: 7, marginTop: 16 },
  para:        { fontSize: 10, color: INK, lineHeight: 1.65, marginBottom: 10 },
  paraHead:    { fontSize: 8, fontWeight: "bold", color: INK, letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 },
  row:         { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  swatch:      { width: 8, height: 8, borderRadius: 2, marginRight: 8 },
  rowLabel:    { fontSize: 9, color: INK, flex: 1 },
  rowPct:      { fontSize: 9, color: MUTED, width: 36, textAlign: "right" },
  rowAmt:      { fontSize: 9, fontWeight: "bold", color: INK, width: 72, textAlign: "right" },
  footer:      { position: "absolute", bottom: 24, left: 40, right: 40, textAlign: "center", fontSize: 7, color: "rgba(0,0,0,0.22)", letterSpacing: 1.5 },
});

export function LiveablePDF({ property, tiles, signal, housingPct, rate, downPct, summary, income }) {
  const paragraphs = summary ? summary.split("\n\n").filter(Boolean) : [];
  const housingMonthly = Math.round(tiles.find(t => t.id === "housing")?.value || 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>

        <View style={s.header}>
          <View>
            <Text style={s.brand}>LIVABLE</Text>
            <Text style={s.tagline}>HOME · BUDGET · LIFE</Text>
          </View>
          <View style={[s.badge, { backgroundColor: signal.color }]}>
            <Text style={s.badgeLabel}>{signal.label.toUpperCase()}</Text>
            <Text style={s.badgePct}>{housingPct.toFixed(0)}% of income</Text>
          </View>
        </View>

        <Text style={s.address}>{property.address}</Text>
        <Text style={s.meta}>
          ${property.price.toLocaleString()} list price · {property.beds}bd {property.baths}ba · ${housingMonthly.toLocaleString()}/mo est. · {rate}% · {downPct}% down
        </Text>

        {paragraphs.length > 0 && (
          <View>
            <Text style={s.secLabel}>AI SUMMARY</Text>
            {paragraphs.map((p, i) => {
              const m = p.match(/^\*\*(.+?)\*\*\s*[—–-]?\s*([\s\S]*)/);
              return m ? (
                <View key={i} style={{ marginBottom: 10 }}>
                  <Text style={s.paraHead}>{m[1]}</Text>
                  <Text style={s.para}>{m[2]}</Text>
                </View>
              ) : (
                <Text key={i} style={s.para}>{p.replace(/\*\*/g, "")}</Text>
              );
            })}
          </View>
        )}

        <Text style={s.secLabel}>MONTHLY BREAKDOWN · ${income.toLocaleString()} TAKE-HOME</Text>
        {tiles.map(t => (
          <View key={t.id} style={s.row}>
            <View style={[s.swatch, { backgroundColor: t.color }]} />
            <Text style={s.rowLabel}>{t.label}{t.locked ? " — Fixed" : ""}</Text>
            <Text style={s.rowPct}>{((t.value / income) * 100).toFixed(1)}%</Text>
            <Text style={s.rowAmt}>${Math.round(t.value).toLocaleString()}/mo</Text>
          </View>
        ))}

        <Text style={s.footer}>Generated with LIVABLE · livable.app</Text>
      </Page>
    </Document>
  );
}
