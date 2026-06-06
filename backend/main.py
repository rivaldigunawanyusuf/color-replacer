# Color Replacer — Luminance-Preserving HSV Recolor Engine
# Copyright (c) 2025 Rivaldi Gunawan Yusuf
# SPDX-License-Identifier: MIT

import io
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


def recolor_image(
    image_bytes: bytes,
    source_hex: str,
    target_hex: str,
    tolerance: int,
) -> bytes:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Could not decode image")

    img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)

    src_h, src_s, src_v = hex_to_hsv(source_hex)
    tgt_h, tgt_s, _ = hex_to_hsv(target_hex)

    # Build hue tolerance range — tolerance maps 0-100 → 0-90 degrees on the 0-179 OpenCV scale
    hue_tol = tolerance * 0.9
    sat_tol = tolerance * 2.55  # 0-255

    h_chan = img_hsv[:, :, 0]
    s_chan = img_hsv[:, :, 1]

    # Handle hue wrap-around (red hues cross 0/179)
    h_diff = np.abs(h_chan - src_h)
    h_diff = np.minimum(h_diff, 180.0 - h_diff)

    s_diff = np.abs(s_chan - src_s)

    mask = (h_diff <= hue_tol) & (s_diff <= sat_tol)

    # Compute per-pixel hue delta to shift smoothly within the mask
    # We shift H and S while preserving V (luminance)
    result_hsv = img_hsv.copy()

    result_hsv[:, :, 0][mask] = tgt_h
    result_hsv[:, :, 1][mask] = tgt_s
    # V channel untouched → highlights, shadows, and texture preserved

    result_hsv = np.clip(result_hsv, 0, 255).astype(np.uint8)
    result_bgr = cv2.cvtColor(result_hsv, cv2.COLOR_HSV2BGR)

    success, encoded = cv2.imencode(".png", result_bgr)
    if not success:
        raise ValueError("Could not encode result image")

    return encoded.tobytes()


@app.post("/api/recolor")
async def recolor(
    image: UploadFile = File(...),
    source_hex: str = Form(...),
    target_hex: str = Form(...),
    tolerance: int = Form(30),
):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    raw = await image.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be under 20 MB")

    try:
        result = recolor_image(raw, source_hex, target_hex, tolerance)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return StreamingResponse(io.BytesIO(result), media_type="image/png")


@app.get("/health")
def health():
    return {"status": "ok"}
