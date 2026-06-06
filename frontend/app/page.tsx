"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";

// ── Types ─────────────────────────────────────────────────────────────────────
type ShapeType = "rect" | "ellipse" | "polygon" | "freehand";
type Region = {
  type: ShapeType;
  x: number; y: number; w: number; h: number;
  radius: number;
  rotation: number; // radians
  sides?: number;   // polygon: 3-8
  points?: { x: number; y: number }[];  // freehand only
};
type InteractionMode = "idle" | "draw" | "move" | "resize" | "rotate";

// ── Canvas constants ──────────────────────────────────────────────────────────
const HANDLE_CURSORS = [
  "nw-resize","n-resize","ne-resize",
  "w-resize",            "e-resize",
  "sw-resize","s-resize","se-resize",
];
const HANDLE_R = 6;

// ── Pure helpers ──────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function rotatePoint(x: number, y: number, cx: number, cy: number, angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx*cos - dy*sin, y: cy + dx*sin + dy*cos };
}

function pointInPoly(px: number, py: number, pts: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const { x: xi, y: yi } = pts[i], { x: xj, y: yj } = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Regular polygon vertices in canvas px, inscribed in the region bounding box
function polyVerts(r: Region, b: { ox:number; oy:number; rw:number; rh:number }) {
  const sides = r.sides ?? 6;
  const cx = b.ox + (r.x + r.w/2) * b.rw;
  const cy = b.oy + (r.y + r.h/2) * b.rh;
  const rx = r.w * b.rw / 2;
  const ry = r.h * b.rh / 2;
  return Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i / sides) - Math.PI / 2;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

function roundedRectPath(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number, r: number) {
  const R = Math.min(r, pw / 2, ph / 2);
  ctx.beginPath();
  ctx.moveTo(px + R, py);
  ctx.lineTo(px + pw - R, py);
  ctx.arcTo(px + pw, py, px + pw, py + R, R);
  ctx.lineTo(px + pw, py + ph - R);
  ctx.arcTo(px + pw, py + ph, px + pw - R, py + ph, R);
  ctx.lineTo(px + R, py + ph);
  ctx.arcTo(px, py + ph, px, py + ph - R, R);
  ctx.lineTo(px, py + R);
  ctx.arcTo(px, py, px + R, py, R);
  ctx.closePath();
}

type Bounds = { ox: number; oy: number; rw: number; rh: number };

function getHandles(r: Region, b: Bounds) {
  const px=b.ox+r.x*b.rw, py=b.oy+r.y*b.rh, pw=r.w*b.rw, ph=r.h*b.rh;
  const cx=px+pw/2, cy=py+ph/2;
  return [
    {x:px,y:py},{x:cx,y:py},{x:px+pw,y:py},
    {x:px,y:cy},            {x:px+pw,y:cy},
    {x:px,y:py+ph},{x:cx,y:py+ph},{x:px+pw,y:py+ph},
  ].map(h=>rotatePoint(h.x,h.y,cx,cy,r.rotation));
}

function getRotateHandle(r: Region, b: Bounds) {
  const px=b.ox+r.x*b.rw, py=b.oy+r.y*b.rh, pw=r.w*b.rw, ph=r.h*b.rh;
  const cx=px+pw/2, cy=py+ph/2;
  return rotatePoint(cx, cy-ph/2-28, cx, cy, r.rotation);
}

// ── RegionCanvas ──────────────────────────────────────────────────────────────
function RegionCanvas({
  imageUrl, regions, onRegionsChange, currentShape, rectRadius, polySides,
}: {
  imageUrl: string;
  regions: Region[];
  onRegionsChange: (r: Region[]) => void;
  currentShape: ShapeType;
  rectRadius: number;
  polySides: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);
  const regionsRef   = useRef(regions);
  useEffect(() => { regionsRef.current = regions; }, [regions]);

  const iRef = useRef<{
    mode: InteractionMode; regionIdx: number; handleIdx: number;
    startMouse: { cx: number; cy: number }; startRect: Region; ghost: Region | null;
    startAngle: number;
  }>({ mode:"idle", regionIdx:-1, handleIdx:-1, startMouse:{cx:0,cy:0}, startRect:{type:"rect",x:0,y:0,w:0,h:0,radius:0,rotation:0}, ghost:null, startAngle:0 });

  const fhRef        = useRef<{ pts: { x: number; y: number }[]; cursor: { x: number; y: number } | null }>({ pts:[], cursor:null });
  const selectedRef  = useRef(-1);
  const clipboardRef = useRef<Region|null>(null);
  const [cursor, setCursor] = useState("crosshair");

  const getBounds = useCallback(() => {
    const img = imgRef.current, con = containerRef.current;
    if (!img || !con) return null;
    const cw = con.clientWidth, ch = con.clientHeight;
    const nw = img.naturalWidth || cw, nh = img.naturalHeight || ch;
    const sc = Math.min(cw / nw, ch / nh);
    const rw = nw * sc, rh = nh * sc;
    return { ox:(cw-rw)/2, oy:(ch-rh)/2, rw, rh };
  }, []);

  const getPos = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  };

  const toNorm = useCallback((cx: number, cy: number) => {
    const b = getBounds(); if (!b) return null;
    return { x: clamp((cx-b.ox)/b.rw,0,1), y: clamp((cy-b.oy)/b.rh,0,1) };
  }, [getBounds]);

  const hitTest = useCallback((cx: number, cy: number) => {
    const b = getBounds(); if (!b) return { regionIdx:-1, handleIdx:-1 };
    const rs = regionsRef.current;
    for (let i = rs.length-1; i >= 0; i--) {
      const r = rs[i];
      const px=b.ox+r.x*b.rw, py=b.oy+r.y*b.rh, pw=r.w*b.rw, ph=r.h*b.rh;
      const rcx=px+pw/2, rcy=py+ph/2;
      // Rotation handle (handleIdx -3)
      if (r.type!=="freehand") {
        const rh=getRotateHandle(r,b);
        if (Math.hypot(cx-rh.x,cy-rh.y)<=9) return { regionIdx:i, handleIdx:-3 };
      }
      // Unrotate mouse for remaining checks
      const u=rotatePoint(cx,cy,rcx,rcy,-r.rotation);
      const ucx=u.x, ucy=u.y;
      // Delete button (unrotated space)
      if (ucx>=px+pw+2 && ucx<=px+pw+18 && ucy>=py-18 && ucy<=py) return { regionIdx:i, handleIdx:-2 };
      // Resize handles (canvas space, already rotated)
      if (r.type!=="freehand") {
        const hs=getHandles(r,b);
        for (let h=0; h<8; h++) if (Math.hypot(cx-hs[h].x,cy-hs[h].y)<=HANDLE_R+2) return { regionIdx:i, handleIdx:h };
      }
      // Body hit-test (unrotated space)
      if (r.type==="freehand" && r.points) {
        const n=toNorm(cx,cy);
        if (n && pointInPoly(n.x,n.y,r.points)) return { regionIdx:i, handleIdx:-1 };
      } else if (r.type==="polygon") {
        if (pointInPoly(ucx,ucy,polyVerts(r,b))) return { regionIdx:i, handleIdx:-1 };
      } else if (ucx>=px && ucx<=px+pw && ucy>=py && ucy<=py+ph) return { regionIdx:i, handleIdx:-1 };
    }
    return { regionIdx:-1, handleIdx:-1 };
  }, [getBounds, toNorm]);

  const applyResize = (snap: Region, h: number, dnx: number, dny: number): Region => {
    let { x, y, w, h: ht } = snap;
    if (h===0||h===3||h===5) { x+=dnx; w-=dnx; }
    if (h===2||h===4||h===7) { w+=dnx; }
    if (h===0||h===1||h===2) { y+=dny; ht-=dny; }
    if (h===5||h===6||h===7) { ht+=dny; }
    if (w<0) { x+=w; w=-w; } if (ht<0) { y+=ht; ht=-ht; }
    return { ...snap, x:clamp(x,0,1), y:clamp(y,0,1), w:clamp(w,0.005,1-clamp(x,0,1)), h:clamp(ht,0.005,1-clamp(y,0,1)) };
  };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current, con = containerRef.current;
    if (!canvas || !con) return;
    canvas.width = con.clientWidth; canvas.height = con.clientHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const b = getBounds(); if (!b) return;

    const drawShape = (r: Region, stroke: string, fill: string, dashed=false) => {
      const px=b.ox+r.x*b.rw, py=b.oy+r.y*b.rh, pw=r.w*b.rw, ph=r.h*b.rh;
      const cx=px+pw/2, cy=py+ph/2;
      ctx.save();
      ctx.translate(cx,cy); ctx.rotate(r.rotation); ctx.translate(-cx,-cy);
      ctx.setLineDash(dashed?[6,4]:[]);
      ctx.lineWidth=2; ctx.strokeStyle=stroke; ctx.fillStyle=fill;
      if (r.type==="rect") {
        roundedRectPath(ctx,px,py,pw,ph,(Math.min(pw,ph)/2)*(r.radius/50));
      } else if (r.type==="ellipse") {
        ctx.beginPath(); ctx.ellipse(cx,cy,pw/2,ph/2,0,0,Math.PI*2); ctx.closePath();
      } else if (r.type==="polygon") {
        const verts = polyVerts(r, b);
        ctx.beginPath();
        verts.forEach((v,i)=>i===0?ctx.moveTo(v.x,v.y):ctx.lineTo(v.x,v.y));
        ctx.closePath();
      } else if (r.type==="freehand" && r.points && r.points.length>=2) {
        ctx.beginPath();
        r.points.forEach((p,i)=>{ const qx=b.ox+p.x*b.rw,qy=b.oy+p.y*b.rh; i===0?ctx.moveTo(qx,qy):ctx.lineTo(qx,qy); });
        ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
      ctx.restore();
    };

    // Draw committed regions
    regionsRef.current.forEach((r,i)=>{
      const sel=i===selectedRef.current;
      drawShape(r, sel?"#ffee00":"#f0f0f0", sel?"rgba(255,238,0,0.13)":"rgba(255,255,255,0.08)");
      const px=b.ox+r.x*b.rw, py=b.oy+r.y*b.rh, pw=r.w*b.rw, ph=r.h*b.rh;
      const rcx=px+pw/2, rcy=py+ph/2;
      // Label + delete in rotated context
      ctx.save();
      ctx.translate(rcx,rcy); ctx.rotate(r.rotation); ctx.translate(-rcx,-rcy);
      ctx.setLineDash([]);
      ctx.font="bold 10px monospace";
      const icon = r.type==="freehand"?"◆":r.type==="ellipse"?"●":r.type==="polygon"?`${r.sides??6}◇`:"■";
      const label=`${icon} #${i+1}${sel?" [C]":""}`;
      const tw=ctx.measureText(label).width;
      ctx.fillStyle=sel?"rgba(255,238,0,0.9)":"rgba(0,0,0,0.75)"; ctx.fillRect(px+4,py+4,tw+8,17);
      ctx.fillStyle=sel?"#0a0a0a":"#f0f0f0"; ctx.fillText(label,px+8,py+15);
      ctx.fillStyle="#ff4444"; ctx.fillRect(px+pw+2,py-18,16,16);
      ctx.fillStyle="#fff"; ctx.font="bold 12px monospace"; ctx.fillText("×",px+pw+5,py-7);
      ctx.restore();
      // Resize + rotate handles (not for freehand)
      if (r.type!=="freehand") {
        getHandles(r,b).forEach(hp=>{
          ctx.setLineDash([]);
          ctx.fillStyle="#0a0a0a"; ctx.fillRect(hp.x-HANDLE_R,hp.y-HANDLE_R,HANDLE_R*2,HANDLE_R*2);
          ctx.strokeStyle="#f0f0f0"; ctx.lineWidth=1.5;
          ctx.strokeRect(hp.x-HANDLE_R,hp.y-HANDLE_R,HANDLE_R*2,HANDLE_R*2);
        });
        const rh=getRotateHandle(r,b), topC=getHandles(r,b)[1];
        ctx.setLineDash([3,3]); ctx.strokeStyle="#888"; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(topC.x,topC.y); ctx.lineTo(rh.x,rh.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(rh.x,rh.y,7,0,Math.PI*2);
        ctx.fillStyle="#ffee00"; ctx.fill();
        ctx.strokeStyle="#0a0a0a"; ctx.lineWidth=1.5; ctx.stroke();
        ctx.fillStyle="#0a0a0a"; ctx.font="bold 9px monospace";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText("↻",rh.x,rh.y);
        ctx.textAlign="left"; ctx.textBaseline="alphabetic";
      }
    });

    // Ghost while drawing
    if (iRef.current.ghost) drawShape(iRef.current.ghost,"#ffee00","rgba(255,238,0,0.10)",true);

    // In-progress freehand
    const { pts, cursor: fhC } = fhRef.current;
    if (pts.length>0) {
      ctx.setLineDash([]); ctx.lineWidth=2; ctx.strokeStyle="#ffee00";
      ctx.beginPath();
      pts.forEach((p,i)=>{ const qx=b.ox+p.x*b.rw,qy=b.oy+p.y*b.rh; i===0?ctx.moveTo(qx,qy):ctx.lineTo(qx,qy); });
      if (fhC) ctx.lineTo(b.ox+fhC.x*b.rw,b.oy+fhC.y*b.rh);
      ctx.stroke();
      pts.forEach((p,i)=>{
        ctx.beginPath(); ctx.arc(b.ox+p.x*b.rw,b.oy+p.y*b.rh,i===0?6:4,0,Math.PI*2);
        ctx.fillStyle=i===0?"#ffee00":"#fff"; ctx.fill();
        ctx.strokeStyle="#ffee00"; ctx.lineWidth=2; ctx.stroke();
      });
      if (fhC && pts.length>=3) {
        const fp=pts[0], d=Math.hypot(fhC.x-fp.x,fhC.y-fp.y);
        if (d*b.rw<15) {
          ctx.beginPath(); ctx.arc(b.ox+fp.x*b.rw,b.oy+fp.y*b.rh,10,0,Math.PI*2);
          ctx.strokeStyle="#ffee00"; ctx.lineWidth=2; ctx.setLineDash([3,3]); ctx.stroke();
        }
      }
    }
  }, [getBounds]);

  useEffect(()=>{ redraw(); },[regions,imageUrl,redraw]);
  useEffect(()=>{
    const con=containerRef.current; if(!con) return;
    const ro=new ResizeObserver(()=>redraw()); ro.observe(con); return ()=>ro.disconnect();
  },[redraw]);
  useEffect(()=>{
    const handler=(e: KeyboardEvent)=>{
      const tag=(e.target as HTMLElement).tagName;
      if (tag==="INPUT"||tag==="TEXTAREA") return;
      const mod=e.metaKey||e.ctrlKey;
      if (mod && e.key==="c") {
        const idx=selectedRef.current;
        if (idx>=0&&idx<regionsRef.current.length) { clipboardRef.current={...regionsRef.current[idx]}; e.preventDefault(); }
      } else if (mod && e.key==="v") {
        if (!clipboardRef.current) return;
        e.preventDefault();
        const src=clipboardRef.current;
        const copy:Region={...src,x:Math.min(src.x+0.02,Math.max(0,1-src.w)),y:Math.min(src.y+0.02,Math.max(0,1-src.h))};
        const next=[...regionsRef.current,copy];
        onRegionsChange(next); regionsRef.current=next;
        selectedRef.current=next.length-1;
        redraw();
      } else if (e.key==="Escape") {
        selectedRef.current=-1; redraw();
      }
    };
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[onRegionsChange,redraw]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const { cx, cy } = getPos(e);
    const b = getBounds();
    if (currentShape==="freehand") {
      const norm=toNorm(cx,cy); if(!norm) return;
      const pts=fhRef.current.pts;
      if (pts.length>=3) {
        const fp=pts[0], d=Math.hypot(norm.x-fp.x,norm.y-fp.y);
        if (d*(b?.rw??1)<15) { commitFreehand(); return; }
      }
      fhRef.current.pts=[...pts,norm]; redraw(); return;
    }
    const { regionIdx, handleIdx }=hitTest(cx,cy);
    // Update selection
    if (regionIdx>=0 && handleIdx===-1) { selectedRef.current=regionIdx; redraw(); }
    else if (regionIdx<0) { selectedRef.current=-1; redraw(); }
    if (handleIdx===-2) { onRegionsChange(regionsRef.current.filter((_,i)=>i!==regionIdx)); selectedRef.current=-1; return; }
    if (regionIdx>=0 && handleIdx===-3) {
      const r=regionsRef.current[regionIdx];
      const bb=getBounds()!;
      const px=bb.ox+r.x*bb.rw, py=bb.oy+r.y*bb.rh, pw=r.w*bb.rw, ph=r.h*bb.rh;
      const rcx=px+pw/2, rcy=py+ph/2;
      iRef.current={ mode:"rotate", regionIdx, handleIdx:-3, startMouse:{cx,cy}, startRect:{...r}, ghost:null, startAngle:Math.atan2(cy-rcy,cx-rcx) };
      return;
    }
    if (regionIdx>=0 && handleIdx>=0) {
      iRef.current={ mode:"resize", regionIdx, handleIdx, startMouse:{cx,cy}, startRect:{...regionsRef.current[regionIdx]}, ghost:null, startAngle:0 }; return;
    }
    if (regionIdx>=0 && handleIdx===-1) {
      iRef.current={ mode:"move", regionIdx, handleIdx:-1, startMouse:{cx,cy}, startRect:{...regionsRef.current[regionIdx]}, ghost:null, startAngle:0 }; return;
    }
    if (!b) return;
    const norm=toNorm(cx,cy); if(!norm) return;
    const newR:Region={ type:currentShape, x:norm.x, y:norm.y, w:0, h:0, radius:rectRadius, rotation:0, sides:polySides };
    iRef.current={ mode:"draw", regionIdx:-1, handleIdx:-1, startMouse:{cx,cy}, startRect:newR, ghost:newR, startAngle:0 };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { cx, cy }=getPos(e);
    const b=getBounds();
    if (currentShape==="freehand" && fhRef.current.pts.length>0) {
      fhRef.current.cursor=toNorm(cx,cy); redraw();
    }
    const mode=iRef.current.mode;
    if (mode==="idle") {
      const { regionIdx:ri, handleIdx:hi }=hitTest(cx,cy);
      let cur="crosshair";
      if(hi===-2) cur="pointer"; else if(hi===-3) cur="grab"; else if(hi>=0) cur=HANDLE_CURSORS[hi]; else if(ri>=0) cur="move";
      setCursor(cur); return;
    }
    const { startMouse, startRect, handleIdx, regionIdx, startAngle }=iRef.current;
    const dx=cx-startMouse.cx, dy=cy-startMouse.cy;
    if (mode==="draw" && b) {
      const norm=toNorm(cx,cy); if(!norm) return;
      iRef.current.ghost={ ...startRect, x:Math.min(startRect.x,norm.x), y:Math.min(startRect.y,norm.y), w:Math.abs(norm.x-startRect.x), h:Math.abs(norm.y-startRect.y) };
      redraw(); return;
    }
    if (!b) return;
    if (mode==="rotate") {
      const px=b.ox+startRect.x*b.rw, py=b.oy+startRect.y*b.rh, pw=startRect.w*b.rw, ph=startRect.h*b.rh;
      const rcx=px+pw/2, rcy=py+ph/2;
      const angle=Math.atan2(cy-rcy,cx-rcx);
      const next=regionsRef.current.map((r,i)=>i===regionIdx?{...r,rotation:startRect.rotation+(angle-startAngle)}:r);
      onRegionsChange(next); regionsRef.current=next; redraw(); return;
    }
    const dnx=dx/b.rw, dny=dy/b.rh;
    if (mode==="move") {
      const next=regionsRef.current.map((r,i)=>i===regionIdx?{...r,x:clamp(startRect.x+dnx,0,1-startRect.w),y:clamp(startRect.y+dny,0,1-startRect.h)}:r);
      onRegionsChange(next); regionsRef.current=next; redraw();
    }
    if (mode==="resize") {
      const cos=Math.cos(-startRect.rotation), sin=Math.sin(-startRect.rotation);
      const ldx=dx*cos-dy*sin, ldy=dx*sin+dy*cos;
      const next=regionsRef.current.map((r,i)=>i===regionIdx?applyResize(startRect,handleIdx,ldx/b.rw,ldy/b.rh):r);
      onRegionsChange(next); regionsRef.current=next; redraw();
    }
  };

  const commitFreehand = useCallback(()=>{
    const pts=fhRef.current.pts;
    if (pts.length>=3) {
      const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
      const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
      onRegionsChange([...regionsRef.current,{ type:"freehand",x,y,w,h,radius:0,rotation:0,points:pts }]);
    }
    fhRef.current={ pts:[],cursor:null }; redraw();
  },[onRegionsChange,redraw]);

  const handleMouseUp = (e: React.MouseEvent)=>{
    const { mode, ghost }=iRef.current;
    if (mode==="draw" && ghost && ghost.w>0.01 && ghost.h>0.01) onRegionsChange([...regionsRef.current,ghost]);
    iRef.current.mode="idle"; iRef.current.ghost=null;
    const { cx, cy }=getPos(e);
    const { regionIdx:ri,handleIdx:hi }=hitTest(cx,cy);
    let cur="crosshair";
    if(hi===-2) cur="pointer"; else if(hi===-3) cur="grab"; else if(hi>=0) cur=HANDLE_CURSORS[hi]; else if(ri>=0) cur="move";
    setCursor(cur); redraw();
  };

  const handleMouseLeave=()=>{
    const { mode, ghost }=iRef.current;
    if (mode==="draw" && ghost && ghost.w>0.01 && ghost.h>0.01) onRegionsChange([...regionsRef.current,ghost]);
    iRef.current.mode="idle"; iRef.current.ghost=null;
    fhRef.current.cursor=null; setCursor("crosshair"); redraw();
  };

  return (
    <div ref={containerRef} style={{ position:"relative",width:"100%",height:"100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={imageUrl} alt="annotate" onLoad={()=>redraw()}
        style={{ width:"100%",height:"100%",objectFit:"contain",display:"block",userSelect:"none" }} />
      <canvas ref={canvasRef}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave}
        onDoubleClick={()=>{ if(currentShape==="freehand"&&fhRef.current.pts.length>=3) commitFreehand(); }}
        style={{ position:"absolute",inset:0,cursor,width:"100%",height:"100%" }} />
    </div>
  );
}

// ── ColorSwatch ───────────────────────────────────────────────────────────────
function ColorSwatch({ label, value, onChange }: { label:string; value:string; onChange:(v:string)=>void }) {
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
      <span style={{ fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",fontSize:"0.65rem",color:"#777" }}>{label}</span>
      <div className="swatch-row">
        <div className="swatch-preview" style={{ background:value }} />
        <input type="color" value={value} onChange={e=>onChange(e.target.value)} className="swatch-input" aria-label={label} />
        <span className="swatch-hex">{value.toUpperCase()}</span>
      </div>
    </div>
  );
}

// ── UploadButton ──────────────────────────────────────────────────────────────
function UploadButton({ onFile }: { onFile:(f:File)=>void }) {
  const ref=useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" style={{ display:"none" }}
        onChange={e=>{ const f=e.target.files?.[0]; if(f) onFile(f); e.target.value=""; }} />
      <button className="upload-btn" onClick={()=>ref.current?.click()}>▲ Upload Image</button>
    </>
  );
}

// ── ShapeBtn ──────────────────────────────────────────────────────────────────
const SHAPE_DEFS: { type: ShapeType; icon: string; label: string }[] = [
  { type:"rect",     icon:"■", label:"Rect"     },
  { type:"ellipse",  icon:"●", label:"Ellipse"  },
  { type:"polygon",  icon:"⬡", label:"Polygon"  },
  { type:"freehand", icon:"◆", label:"Freehand" },
];

const SIDES_ICONS: Record<number, string> = { 3:"△", 4:"◻", 5:"⬠", 6:"⬡", 7:"", 8:"" };

// ── Home ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [file,         setFile]         = useState<File|null>(null);
  const [originalUrl,  setOriginalUrl]  = useState<string|null>(null);
  const [resultUrl,    setResultUrl]    = useState<string|null>(null);
  const [sourceHex,    setSourceHex]    = useState("#4a7c59");
  const [targetHex,    setTargetHex]    = useState("#1a3fa0");
  const [tolerance,    setTolerance]    = useState(30);
  const [regions,      setRegions]      = useState<Region[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string|null>(null);
  const [showResult,   setShowResult]   = useState(false);
  const [currentShape, setCurrentShape] = useState<ShapeType>("rect");
  const [rectRadius,   setRectRadius]   = useState(0);
  const [polySides,    setPolySides]    = useState(6);
  const [invertMode,   setInvertMode]   = useState(false);

  const handleFile=useCallback((f:File)=>{
    setFile(f); setResultUrl(null); setError(null); setRegions([]); setShowResult(false);
    setOriginalUrl(URL.createObjectURL(f));
  },[]);

  const handleRecolor=async()=>{
    if (!file) return;
    setLoading(true); setError(null); setResultUrl(null);
    const form=new FormData();
    form.append("image",file);
    form.append("source_hex",sourceHex.replace("#",""));
    form.append("target_hex",targetHex.replace("#",""));
    form.append("tolerance",String(tolerance));
    form.append("regions",JSON.stringify(regions));
    form.append("invert",String(invertMode));
    try {
      const res=await fetch("http://localhost:8000/api/recolor",{ method:"POST",body:form });
      if (!res.ok) { const d=await res.json().catch(()=>({})); throw new Error((d as{detail?:string}).detail??`Server error ${res.status}`); }
      setResultUrl(URL.createObjectURL(await res.blob())); setShowResult(true);
    } catch(e:unknown) { setError(e instanceof Error?e.message:"Unknown error"); }
    finally { setLoading(false); }
  };

  const handleDownload=()=>{
    if (!resultUrl) return;
    const a=document.createElement("a"); a.href=resultUrl; a.download="recolored.png"; a.click();
  };

  return (
    <main className="page-wrap">
      {/* ── Header ── */}
      <header style={{ borderBottom:"2px solid #f0f0f0", paddingBottom:20, marginBottom:28 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <span style={{ background:"#f0f0f0", color:"#0a0a0a", fontWeight:800, fontSize:"0.6rem", letterSpacing:"0.2em", padding:"4px 10px", textTransform:"uppercase", flexShrink:0 }}>
            Tool
          </span>
          <h1 style={{ fontSize:"clamp(1.6rem,4vw,3rem)", fontWeight:800, letterSpacing:"-0.02em", margin:0, textTransform:"uppercase", lineHeight:1 }}>
            Color Replacer
          </h1>
        </div>
        <p style={{ marginTop:8, color:"#666", fontSize:"0.72rem", letterSpacing:"0.08em", textTransform:"uppercase", margin:"8px 0 0" }}>
          Luminance-preserving HSV masking — draw regions to isolate exactly what gets recolored
        </p>
      </header>

      <div className="app-grid">

        {/* ── Left: Controls ── */}
        <aside>
          <div className="control-panel">

            {/* 01 Image */}
            <div>
              <p className="section-label">01 — Image</p>
              <UploadButton onFile={handleFile} />
              {file && <p className="hint-text" style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{file.name}</p>}
            </div>

            {/* 02 Source */}
            <div>
              <p className="section-label">02 — Source Color</p>
              <p className="hint-text" style={{ marginBottom:8,marginTop:0 }}>Color on the image to replace</p>
              <ColorSwatch label="Color to replace" value={sourceHex} onChange={setSourceHex} />
            </div>

            {/* 03 Target */}
            <div>
              <p className="section-label">03 — Target Color</p>
              <p className="hint-text" style={{ marginBottom:8,marginTop:0 }}>New brand color to apply</p>
              <ColorSwatch label="New color" value={targetHex} onChange={setTargetHex} />
            </div>

            {/* 04 Tolerance */}
            <div>
              <p className="section-label">04 — Tolerance</p>
              <input type="range" min={0} max={100} value={tolerance} onChange={e=>setTolerance(Number(e.target.value))} />
              <div style={{ display:"flex",justifyContent:"space-between",fontSize:"0.62rem",color:"#555",marginTop:6,letterSpacing:"0.06em" }}>
                <span>STRICT</span>
                <span style={{ color:"#f0f0f0",fontWeight:800 }}>{tolerance}</span>
                <span>LOOSE</span>
              </div>
            </div>

            {/* 05 Shape */}
            <div>
              <p className="section-label">05 — Draw Shape</p>
              <div className="shape-row">
                {SHAPE_DEFS.map(s=>(
                  <button key={s.type} className={`shape-btn${currentShape===s.type?" active":""}`} onClick={()=>setCurrentShape(s.type)}>
                    <span className="shape-icon">{s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
              {currentShape==="rect" && (
                <div style={{ marginTop:12 }}>
                  <p className="hint-text" style={{ textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6,marginTop:0 }}>Corner Radius</p>
                  <input type="range" min={0} max={50} value={rectRadius} onChange={e=>setRectRadius(Number(e.target.value))} />
                  <div style={{ display:"flex",justifyContent:"space-between",fontSize:"0.62rem",color:"#555",marginTop:6 }}>
                    <span>SHARP</span>
                    <span style={{ color:"#f0f0f0",fontWeight:800 }}>{rectRadius}%</span>
                    <span>ROUND</span>
                  </div>
                </div>
              )}
              {currentShape==="polygon" && (
                <div style={{ marginTop:12 }}>
                  <p className="hint-text" style={{ textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6,marginTop:0 }}>Sides</p>
                  <div style={{ display:"flex",gap:4 }}>
                    {[3,4,5,6,7,8].map(n=>(
                      <button key={n}
                        onClick={()=>setPolySides(n)}
                        style={{ fontFamily:"inherit",fontWeight:800,fontSize:"0.65rem",letterSpacing:"0.06em",flex:1,padding:"6px 2px",border:`1px solid ${polySides===n?"#f0f0f0":"#2a2a2a"}`,background:polySides===n?"#f0f0f0":"transparent",color:polySides===n?"#0a0a0a":"#666",cursor:"pointer" }}>
                        {SIDES_ICONS[n]}{n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {currentShape==="freehand" && (
                <p className="hint-text" style={{ marginTop:8 }}>
                  Click to add points · Click start point or double-click to close polygon
                </p>
              )}
            </div>

            {/* 06 Regions */}
            <div>
              <p className="section-label">06 — Regions
                {regions.length>0 && <span style={{ fontWeight:400,color:"#555",marginLeft:8 }}>({regions.length})</span>}
              </p>
              {regions.length===0 ? (
                <p className="hint-text">No regions marked — full image will be processed</p>
              ) : (
                <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
                  {regions.map((r,i)=>(
                    <div key={i} className="region-item">
                      <span className="region-item-label">
                        {r.type==="freehand"?"◆":r.type==="ellipse"?"●":r.type==="polygon"?`${SIDES_ICONS[r.sides??6]}`:"■"} #{i+1} &nbsp;
                        {Math.round(r.w*100)}%×{Math.round(r.h*100)}%
                        {r.type==="rect"&&r.radius>0?` · r${r.radius}%`:""}
                        {r.type==="polygon"?` · ${r.sides??6}sides`:""}
                      </span>
                      <button className="region-del-btn" onClick={()=>setRegions(regions.filter((_,j)=>j!==i))}>×</button>
                    </div>
                  ))}
                  <button
                    onClick={()=>setRegions([])}
                    style={{ fontFamily:"inherit",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",background:"transparent",color:"#ff4444",border:"1px solid #ff4444",padding:"6px 10px",fontSize:"0.62rem",cursor:"pointer",marginTop:4 }}>
                    ✕ Clear All
                  </button>
                </div>
              )}
            </div>

            {/* 07 Invert */}
            <div>
              <p className="section-label">07 — Invert Mode</p>
              <button className={`invert-btn${invertMode?" on":""}`} onClick={()=>setInvertMode(v=>!v)}>
                <span>{invertMode?"⊘ PROTECT MARKED":"⊘ NORMAL MODE"}</span>
                <span style={{ fontFamily:"monospace",fontSize:"0.65rem",opacity:0.7 }}>{invertMode?"ON":"OFF"}</span>
              </button>
              <p className="hint-text">
                {invertMode
                  ? "Marked regions are PROTECTED — everything outside gets recolored"
                  : "Only marked regions get recolored (or full image if none)"}
              </p>
            </div>

            {/* Execute */}
            <button className="exec-btn" onClick={handleRecolor} disabled={!file||loading}>
              {loading ? "PROCESSING..." : "▶ EXECUTE RECOLOR"}
            </button>

            {error && <div className="error-box">ERROR: {error}</div>}
          </div>
        </aside>

        {/* ── Right: Canvas / Result ── */}
        <section style={{ display:"flex",flexDirection:"column",gap:16,minWidth:0 }}>

          {/* Tabs */}
          {originalUrl && resultUrl && (
            <div className="tab-bar">
              {["MARK REGIONS","COMPARE RESULT"].map(label=>{
                const active=label==="MARK REGIONS"?!showResult:showResult;
                return (
                  <button key={label} className={`tab-btn${active?" active":""}`} onClick={()=>setShowResult(label==="COMPARE RESULT")}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Annotation view */}
          {!showResult && !loading && (
            <div className="annotation-wrap">
              {!originalUrl ? (
                <div className="drop-zone"
                  onClick={()=>{ const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=e=>{ const f=(e.target as HTMLInputElement).files?.[0];if(f) handleFile(f);};i.click(); }}
                  onDragOver={e=>e.preventDefault()}
                  onDrop={e=>{ e.preventDefault();const f=e.dataTransfer.files[0];if(f?.type.startsWith("image/")) handleFile(f); }}>
                  <div className="drop-zone-icon">▲</div>
                  <p className="drop-zone-title">Drop image here</p>
                  <p className="drop-zone-sub">or click to browse · PNG, JPG, WEBP up to 20 MB</p>
                </div>
              ) : (
                <>
                  <div className="annotation-toolbar">
                    <span className={`badge${currentShape!=="rect"?" badge-yellow":""}`}>
                      {currentShape==="rect"?"■ RECT":currentShape==="ellipse"?"● ELLIPSE":currentShape==="polygon"?`${SIDES_ICONS[polySides]} POLY-${polySides}`:"◆ FREEHAND"}
                    </span>
                    {invertMode && <span className="badge badge-orange">⊘ PROTECT</span>}
                    <span style={{ fontSize:"0.62rem",color:"#555",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                      {currentShape==="freehand"
                        ?"Click to add points · double-click or click start to close"
                        :currentShape==="polygon"
                        ?"Drag to draw polygon · drag body to move · drag handle to resize"
                        :"Drag to draw · drag body to move · drag handle to resize"}
                    </span>
                    <span style={{ fontSize:"0.62rem",color:regions.length>0?"#f0f0f0":"#444",fontWeight:800,letterSpacing:"0.1em",flexShrink:0 }}>
                      {regions.length===0?"FULL IMAGE":`${regions.length} REGION${regions.length>1?"S":""}`}
                    </span>
                  </div>
                  <div className="canvas-area">
                    <RegionCanvas imageUrl={originalUrl} regions={regions} onRegionsChange={setRegions} currentShape={currentShape} rectRadius={rectRadius} polySides={polySides} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Compare result */}
          {showResult && !loading && originalUrl && resultUrl && (
            <div className="annotation-wrap">
              <div className="annotation-toolbar">
                <span className="badge">← ORIGINAL</span>
                <span style={{ fontSize:"0.62rem",color:"#555" }}>Drag the slider to compare</span>
                <span className="badge" style={{ marginLeft:"auto" }}>RECOLORED →</span>
              </div>
              <div className="canvas-area">
                <ReactCompareSlider
                  itemOne={<ReactCompareSliderImage src={originalUrl} alt="original" style={{ objectFit:"contain" }} />}
                  itemTwo={<ReactCompareSliderImage src={resultUrl} alt="result" style={{ objectFit:"contain" }} />}
                  style={{ width:"100%",height:"100%" }} />
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="loading-panel">
              <div className="spinner" />
              <span style={{ fontWeight:800,letterSpacing:"0.2em",fontSize:"0.75rem",textTransform:"uppercase" }}>Processing...</span>
              {regions.length>0 && (
                <span style={{ fontSize:"0.65rem",color:"#555" }}>
                  Applying to {regions.length} region{regions.length>1?"s":""}{invertMode?" (protect mode)":""}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          {resultUrl && !loading && (
            <div className="action-row">
              <button className="ghost-btn" onClick={()=>{ setShowResult(false);setResultUrl(null); }}>
                ← Re-annotate
              </button>
              <button className="dl-btn" onClick={handleDownload}>
                ↓ Download Result
              </button>
            </div>
          )}
        </section>
      </div>

      <footer style={{ borderTop:"1px solid #1a1a1a", marginTop:48, paddingTop:14, fontSize:"0.6rem", color:"#444", letterSpacing:"0.12em", textTransform:"uppercase", display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <span>Color Replacer — MIT © 2026 Rivaldi Gunawan Yusuf</span>
        <span>HSV Luminance-Preserving Engine</span>
      </footer>
    </main>
  );
}
