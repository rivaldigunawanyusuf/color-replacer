# Color Replacer

> Luminance-preserving HSV color replacement for any image with patterned colors.  
> Replace any color while keeping highlights, shadows, and texture intact — works on domes, fabrics, products, illustrations, and more.

**Author:** Rivaldi Gunawan Yusuf  
**License:** MIT  
**GitHub:** [github.com/rivaldigunawanyusuf/color-replacer](https://github.com/rivaldigunawanyusuf/color-replacer)

---

## Prerequisites

Make sure the following are installed on your machine before proceeding:

| Tool | Version | Check |
|------|---------|-------|
| Python | 3.10+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| git | any | `git --version` |

---

## Installation & Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/color-replacer.git
cd color-replacer
```

### 2. Backend setup (Python / FastAPI)

```bash
cd backend

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Start the dev server
uvicorn main:app --reload --port 8000
```

The API will be available at **http://localhost:8000**.  
Interactive docs: **http://localhost:8000/docs**

> If port 8000 is already in use:
> ```bash
> lsof -ti :8000 | xargs kill -9   # macOS / Linux
> ```

### 3. Frontend setup (Next.js)

Open a **new terminal tab**, then:

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The app will be available at **http://localhost:3000**.

---

## One-command launcher

Alternatively, run both servers at once from the project root:

**macOS / Linux:**
```bash
chmod +x start.sh
./start.sh
```

**Windows:**
```bat
start.bat
```

Both scripts auto-create the Python venv and install all deps on first run.

---

## Project Structure

```
color-replacer/
├── backend/
│   ├── main.py              # FastAPI app — HSV recolor engine
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Main UI — upload, controls, preview
│   │   ├── layout.tsx       # Root layout + Syne font
│   │   └── globals.css      # Brutalist design tokens
│   ├── next.config.ts
│   └── package.json
├── start.sh                 # One-command launcher (macOS / Linux)
├── start.bat                # One-command launcher (Windows)
├── LICENSE
└── README.md
```

---

## How it works

1. Upload any image.
2. Pick the **Source Color** — the color on the image you want to replace.
3. Pick the **Target Color** — the color you want to replace it with.
4. Adjust **Tolerance** — higher = looser matching (captures more shade variation of the source).
5. Click **EXECUTE RECOLOR** and drag the before/after slider to compare.
6. Download the result.

### Engine

The backend converts the image to HSV, builds a mask of pixels whose hue and saturation fall within `tolerance` of the source color, then shifts only H and S to match the target — leaving the **V (Value/luminance) channel untouched**. This preserves tile highlights, grout shadows, and surface texture for a photorealistic result.

---

## API Reference

`POST http://localhost:8000/api/recolor`

| Field | Type | Description |
|-------|------|-------------|
| `image` | File | Image to process (≤ 20 MB) |
| `source_hex` | string | Hex color to replace (without `#`) |
| `target_hex` | string | Target hex color (without `#`) |
| `tolerance` | int 0–100 | Hue/saturation matching radius |

Returns: `image/png`

---

## Tech Stack

- **Backend:** Python, FastAPI, OpenCV, NumPy
- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Design:** Monochrome Brutalist — Syne font, high-contrast, sharp borders

---

## License

MIT © 2026 Rivaldi Gunawan Yusuf
