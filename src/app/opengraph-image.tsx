import { ImageResponse } from "next/og";

export const alt = "InvoiceReconcile incoming payment matching";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#f4f5f1", color: "#17201d", padding: 72, fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", width: "100%", border: "2px solid #cdd4cf", background: "#ffffff" }}>
        <div style={{ width: "62%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 58 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 26, fontWeight: 700 }}><div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", background: "#176b4d", color: "white" }}>IR</div>InvoiceReconcile</div>
          <div style={{ display: "flex", flexDirection: "column" }}><div style={{ fontSize: 62, lineHeight: 1.02, letterSpacing: "-3px", fontWeight: 700 }}>Stop matching invoice payments by hand.</div><div style={{ marginTop: 26, color: "#5e6b65", fontSize: 25, lineHeight: 1.4 }}>Match CSV and Excel payments to invoices. Review, confirm, and export.</div></div>
          <div style={{ display: "flex", gap: 12, color: "#176b4d", fontSize: 20, fontWeight: 700 }}>Combined payments · Partials · Fees · Audit history</div>
        </div>
        <div style={{ width: "38%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 45, background: "#15372a", color: "white" }}>
          <div style={{ fontSize: 18, color: "#9cdfbd", textTransform: "uppercase", letterSpacing: 2 }}>Fictional sample</div>
          <div style={{ marginTop: 28, fontSize: 24, color: "#c9dbd2" }}>Incoming ACH</div>
          <div style={{ marginTop: 8, fontSize: 48, fontWeight: 700 }}>$4,725.00</div>
          <div style={{ height: 2, background: "#587668", margin: "30px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}><span>3 invoices</span><span>$4,725.00</span></div>
          <div style={{ marginTop: 26, display: "flex", padding: "14px 16px", background: "#e6f4ed", color: "#176b4d", fontSize: 20, fontWeight: 700 }}>Exact combined match</div>
        </div>
      </div>
    </div>,
    size,
  );
}
