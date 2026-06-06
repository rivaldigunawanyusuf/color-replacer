# Color Replacer — Luminance-Preserving HSV Recolor Engine
# Copyright (c) 2025 Rivaldi Gunawan Yusuf
# SPDX-License-Identifier: MIT

import io
import json
import math
import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

app = FastAPI(title="Color Replacer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def hex_to_bgr(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return (b, g, r)


def hex_to_hsv(hex_color: str) -> tuple[float, float, float]:
    bgr = np.uint8([[list(hex_to_bgr(hex_color))]])
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    return tuple(hsv[0][0].tolist())


def fill_rounded_rect(mask: np.ndarray, x1: int, y1: int, x2: int, y2: int, radius: int):
    """Fill a rounded rectangle into an uint8 mask (value 255)."""
    r = max(0, min(radius, (x2 - x1) // 2, (y2 - y1) // 2))
    if r == 0:
        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
        return
    # Two overlapping rects cover the body
    cv2.rectangle(mask, (x1 + r, y1), (x2 - r, y2), 255, -1)
    cv2.rectangle(mask, (x1, y1 + r), (x2, y2 - r), 255, -1)
    # Four corner arcs
    cv2.ellipse(mask, (x1 + r, y1 + r), (r, r), 180, 0, 90, 255, -1)
    cv2.ellipse(mask, (x2 - r, y1 + r), (r, r), 270, 0, 90, 255, -1)
    cv2.ellipse(mask, (x1 + r, y2 - r), (r, r), 90,  0, 90, 255, -1)
    cv2.ellipse(mask, (x2 - r, y2 - r), (r, r), 0,   0, 90, 255, -1)


def build_region_mask(img_h: int, img_w: int, regions: list[dict]) -> np.ndarray:
    """
    Build a boolean mask from a list of regions.
    Each region: { type, x, y, w, h (normalized 0-1), radius (0-50%), points? }
    Supported types: "rect", "ellipse", "freehand"
    """
    mask = np.zeros((img_h, img_w), dtype=np.uint8)

    for region in regions:
        x1 = max(0, int(region["x"] * img_w))
        y1 = max(0, int(region["y"] * img_h))
        x2 = min(img_w, int((region["x"] + region["w"]) * img_w))
        y2 = min(img_h, int((region["y"] + region["h"]) * img_h))
        shape    = region.get("type", "rect")
        rotation = float(region.get("rotation", 0))  # radians from frontend

        if shape == "rect":
            if rotation == 0:
                radius_pct = float(region.get("radius", 0))
                short_side = min(x2 - x1, y2 - y1)
                radius_px  = int(short_side * radius_pct / 100)
                fill_rounded_rect(mask, x1, y1, x2, y2, radius_px)
            else:
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                corners = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
                cos_r, sin_r = math.cos(rotation), math.sin(rotation)
                rotated = [
                    (int(cx + (px - cx) * cos_r - (py - cy) * sin_r),
                     int(cy + (px - cx) * sin_r + (py - cy) * cos_r))
                    for px, py in corners
                ]
                cv2.fillPoly(mask, [np.array(rotated, dtype=np.int32)], 255)

        elif shape == "ellipse":
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            ax = max(1, (x2 - x1) // 2)
            ay = max(1, (y2 - y1) // 2)
            cv2.ellipse(mask, (cx, cy), (ax, ay), math.degrees(rotation), 0, 360, 255, -1)

        elif shape == "polygon":
            sides = max(3, min(8, int(region.get("sides", 6))))
            cx = (x1 + x2) / 2; cy = (y1 + y2) / 2
            rx = (x2 - x1) / 2; ry = (y2 - y1) / 2
            pts = [
                [int(cx + rx * math.cos(2 * math.pi * i / sides - math.pi / 2 + rotation)),
                 int(cy + ry * math.sin(2 * math.pi * i / sides - math.pi / 2 + rotation))]
                for i in range(sides)
            ]
            cv2.fillPoly(mask, [np.array(pts, dtype=np.int32)], 255)

        elif shape == "freehand":
            pts = region.get("points", [])
            if len(pts) >= 3:
                arr = np.array(
                    [[int(p["x"] * img_w), int(p["y"] * img_h)] for p in pts],
                    dtype=np.int32,
                )
                cv2.fillPoly(mask, [arr], 255)

    return mask.astype(bool)


def recolor_image(
    image_bytes: bytes,
    source_hex: str,
    target_hex: str,
    tolerance: int,
    regions: list[dict],
    invert: bool,
) -> bytes:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Could not decode image")

    img_h, img_w = img_bgr.shape[:2]
    img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)

    src_h, src_s, _ = hex_to_hsv(source_hex)
    tgt_h, tgt_s, _ = hex_to_hsv(target_hex)

    hue_tol = tolerance * 0.9    # 0-100 → 0-90° on OpenCV 0-179 scale
    sat_tol = tolerance * 2.55   # 0-100 → 0-255

    h_chan = img_hsv[:, :, 0]
    s_chan = img_hsv[:, :, 1]

    h_diff = np.abs(h_chan - src_h)
    h_diff = np.minimum(h_diff, 180.0 - h_diff)  # hue wrap-around
    s_diff = np.abs(s_chan - src_s)

    color_mask = (h_diff <= hue_tol) & (s_diff <= sat_tol)

    if regions:
        region_mask = build_region_mask(img_h, img_w, regions)
        if invert:
            # Protect marked regions — recolor everything outside
            color_mask = color_mask & ~region_mask
        else:
            # Only recolor inside marked regions
            color_mask = color_mask & region_mask

    # Shift H and S; leave V (luminance) untouched → textures preserved
    result_hsv = img_hsv.copy()
    result_hsv[:, :, 0][color_mask] = tgt_h
    result_hsv[:, :, 1][color_mask] = tgt_s

    result_hsv = np.clip(result_hsv, 0, 255).astype(np.uint8)
    result_bgr = cv2.cvtColor(result_hsv, cv2.COLOR_HSV2BGR)

    success, encoded = cv2.imencode(".png", result_bgr)
    if not success:
        raise ValueError("Could not encode result image")
    return encoded.tobytes()


@app.post("/api/recolor")
async def recolor(
    image:      UploadFile = File(...),
    source_hex: str  = Form(...),
    target_hex: str  = Form(...),
    tolerance:  int  = Form(30),
    regions:    str  = Form("[]"),   # JSON array of region objects
    invert:     bool = Form(False),  # protect marked regions instead
):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    raw = await image.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be under 20 MB")

    try:
        parsed_regions = json.loads(regions)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid regions JSON")

    try:
        result = recolor_image(raw, source_hex, target_hex, tolerance, parsed_regions, invert)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return StreamingResponse(io.BytesIO(result), media_type="image/png")


@app.get("/health")
def health():
    return {"status": "ok"}
