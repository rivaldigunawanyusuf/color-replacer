"use client";

import { useState, useCallback, useRef } from "react";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";

function ColorSwatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.7rem", color: "#999" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 48, height: 48, background: value, border: "2px solid #f0f0f0", flexShrink: 0 }} />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 48, height: 48, border: "2px solid #f0f0f0", background: "transparent", cursor: "pointer", padding: 0 }}
          aria-label={label}
        />
        <span style={{ fontFamily: "monospace", fontSize: "0.85rem", letterSpacing: "0.08em" }}>
          {value.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function DropZone({ onFile, preview }: { onFile: (f: File) => void; preview: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px ${dragging ? "solid" : "dashed"} #f0f0f0`,
        background: dragging ? "#1a1a1a" : "#111",
        minHeight: 180,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="uploaded" style={{ maxHeight: 180, maxWidth: "100%", objectFit: "contain" }} />
      ) : (
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>▲</div>
          <p style={{ fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}>Drop image here</p>
          <p style={{ fontSize: "0.75rem", color: "#666", marginTop: 6, letterSpacing: "0.05em" }}>or click to browse</p>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", fontSize: "0.72rem", marginBottom: 10, marginTop: 0, borderBottom: "1px solid #222", paddingBottom: 6 }}>
      {children}
    </p>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ background: "#f0f0f0", color: "#0a0a0a", fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.15em", padding: "3px 8px", textTransform: "uppercase" }}>
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: 40, height: 40, border: "3px solid #333", borderTop: "3px solid #f0f0f0", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [sourceHex, setSourceHex] = useState("#4a7c59");
  const [targetHex, setTargetHex] = useState("#1a3fa0");
  const [tolerance, setTolerance] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResultUrl(null);
    setError(null);
    setOriginalUrl(URL.createObjectURL(f));
  }, []);

  const handleRecolor = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResultUrl(null);

    const form = new FormData();
    form.append("image", file);
    form.append("source_hex", sourceHex.replace("#", ""));
    form.append("target_hex", targetHex.replace("#", ""));
    form.append("tolerance", String(tolerance));

    try {
      const res = await fetch("http://localhost:8000/api/recolor", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { detail?: string }).detail ?? `Server error ${res.status}`);
      }
      setResultUrl(URL.createObjectURL(await res.blob()));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = "recolored.png";
    a.click();
  };

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <header style={{ borderBottom: "2px solid #f0f0f0", paddingBottom: 24, marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <span style={{ background: "#f0f0f0", color: "#0a0a0a", fontWeight: 800, fontSize: "0.65rem", letterSpacing: "0.2em", padding: "4px 10px", textTransform: "uppercase" }}>
            Tool
          </span>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 800, letterSpacing: "-0.02em", margin: 0, textTransform: "uppercase" }}>
            Color Replacer
          </h1>
        </div>
        <p style={{ marginTop: 10, color: "#777", fontSize: "0.8rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Luminance-preserving HSV masking — isolate &amp; recolor any hue, textures intact
        </p>
      </header>

      {/* Body */}
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 32 }}>
        {/* Controls */}
        <aside>
          <section style={{ border: "2px solid #f0f0f0", padding: 24, display: "flex", flexDirection: "column", gap: 28 }}>
            <div>
              <Label>01 — Upload</Label>
              <DropZone onFile={handleFile} preview={originalUrl} />
            </div>

            <div>
              <Label>02 — Source Color</Label>
              <p style={{ fontSize: "0.72rem", color: "#777", marginBottom: 12, marginTop: 0, letterSpacing: "0.05em" }}>
                The color on the dome to replace
              </p>
              <ColorSwatch label="Color to replace" value={sourceHex} onChange={setSourceHex} />
            </div>

            <div>
              <Label>03 — Target Color</Label>
              <p style={{ fontSize: "0.72rem", color: "#777", marginBottom: 12, marginTop: 0, letterSpacing: "0.05em" }}>
                The new brand color to apply
              </p>
              <ColorSwatch label="New color" value={targetHex} onChange={setTargetHex} />
            </div>

            <div>
              <Label>04 — Tolerance</Label>
              <p style={{ fontSize: "0.72rem", color: "#777", marginBottom: 12, marginTop: 0, letterSpacing: "0.05em" }}>
                How strictly to match the source hue
              </p>
              <input type="range" min={0} max={100} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#666", marginTop: 6, letterSpacing: "0.06em" }}>
                <span>STRICT</span>
                <span style={{ color: "#f0f0f0", fontWeight: 700 }}>{tolerance}</span>
                <span>LOOSE</span>
              </div>
            </div>

            <button
              onClick={handleRecolor}
              disabled={!file || loading}
              style={{
                fontFamily: "inherit", fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase",
                background: file && !loading ? "#f0f0f0" : "#1a1a1a",
                color: file && !loading ? "#0a0a0a" : "#444",
                border: "2px solid #f0f0f0",
                cursor: file && !loading ? "pointer" : "not-allowed",
                padding: "16px 24px", fontSize: "0.85rem", width: "100%", transition: "all 0.1s",
              }}
            >
              {loading ? "PROCESSING..." : "▶ EXECUTE RECOLOR"}
            </button>

            {error && (
              <div style={{ border: "2px solid #ff3333", padding: "12px 16px", color: "#ff3333", fontSize: "0.75rem", letterSpacing: "0.04em" }}>
                ERROR: {error}
              </div>
            )}
          </section>
        </aside>

        {/* Preview */}
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ border: "2px solid #f0f0f0", flex: 1, minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#111", position: "relative" }}>
            {!originalUrl && (
              <div style={{ textAlign: "center", color: "#333" }}>
                <div style={{ fontSize: "4rem", marginBottom: 12 }}>◻</div>
                <p style={{ fontWeight: 700, letterSpacing: "0.15em", fontSize: "0.75rem", textTransform: "uppercase" }}>Upload an image to begin</p>
              </div>
            )}

            {originalUrl && !resultUrl && !loading && (
              <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "8px 14px", background: "#1a1a1a", borderBottom: "1px solid #222", fontWeight: 700, fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "#666" }}>
                  ORIGINAL
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={originalUrl} alt="original" style={{ flex: 1, objectFit: "contain", maxHeight: 460 }} />
              </div>
            )}

            {originalUrl && resultUrl && (
              <div style={{ width: "100%", height: "100%", position: "relative" }}>
                <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10 }}>
                  <Tag>← ORIGINAL · DRAG · RECOLORED →</Tag>
                </div>
                <ReactCompareSlider
                  itemOne={<ReactCompareSliderImage src={originalUrl} alt="original" style={{ objectFit: "contain" }} />}
                  itemTwo={<ReactCompareSliderImage src={resultUrl} alt="result" style={{ objectFit: "contain" }} />}
                  style={{ height: "100%", width: "100%", minHeight: 480 }}
                />
              </div>
            )}

            {loading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <Spinner />
                <span style={{ fontWeight: 700, letterSpacing: "0.2em", fontSize: "0.75rem", textTransform: "uppercase" }}>Processing...</span>
              </div>
            )}
          </div>

          {resultUrl && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={handleDownload}
                onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f0f0f0"; (e.currentTarget as HTMLButtonElement).style.color = "#0a0a0a"; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#f0f0f0"; }}
                style={{ fontFamily: "inherit", fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", background: "transparent", color: "#f0f0f0", border: "2px solid #f0f0f0", padding: "14px 24px", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.1s" }}
              >
                ↓ DOWNLOAD RESULT
              </button>
            </div>
          )}
        </section>
      </div>

      <footer style={{ borderTop: "2px solid #222", marginTop: 48, paddingTop: 16, fontSize: "0.65rem", color: "#444", letterSpacing: "0.12em", textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
        <span>Color Replacer — Local Tool</span>
        <span>HSV Luminance-Preserving Engine</span>
      </footer>
    </main>
  );
}
