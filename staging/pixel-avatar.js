/*!
 * pixel-avatar.js — turn any uploaded photo into a pixel-art avatar.
 * Zero dependencies. Zero network. Zero API tokens. Pure <canvas>.
 *
 * Works three ways with no build step:
 *   - ES module:   import { pixelize, attachAvatarPicker } from './pixel-avatar.js'
 *   - Global:      window.PixelAvatar.pixelize(...)
 *   - CommonJS:    const { pixelize } = require('./pixel-avatar.js')
 *
 * The pipeline:
 *   load -> center square-crop -> downscale (averaging) ->
 *   optional palette quantize (+ ordered dither) ->
 *   nearest-neighbor upscale (crisp pixels) -> optional circular mask -> export
 */

// ---------------------------------------------------------------------------
// Built-in palettes. Pass `palette: 'pico8'` or your own array of hex strings.
// `null` (default) keeps full colour and just chunkifies — the beat-hive look.
// ---------------------------------------------------------------------------
const PALETTES = {
  pico8: [
    '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F',
    '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436',
    '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
  ],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  gameboyPocket: ['#181818', '#4a4a4a', '#8c8c8c', '#e0e0e0'],
  // A warm, saturated 16-colour set that flatters skin tones for avatars.
  sweet16: [
    '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070',
    '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7',
    '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
  ],
};

// 4x4 Bayer matrix for ordered dithering (values normalised to [-0.5, 0.5)).
const BAYER4 = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];

// ---------------------------------------------------------------------------
// Source loading — accepts File/Blob, data URL, remote URL, or an <img>.
// ---------------------------------------------------------------------------
function loadImage(source) {
  return new Promise((resolve, reject) => {
    if (source instanceof HTMLImageElement) {
      if (source.complete && source.naturalWidth) return resolve(source);
      source.addEventListener('load', () => resolve(source), { once: true });
      source.addEventListener('error', reject, { once: true });
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous'; // allow remote URLs without tainting canvas
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('pixel-avatar: could not load image'));
    if (source instanceof Blob) {
      const url = URL.createObjectURL(source);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('pixel-avatar: bad image blob')); };
      img.src = url;
    } else if (typeof source === 'string') {
      img.src = source;
    } else {
      reject(new Error('pixel-avatar: unsupported source type'));
    }
  });
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function nearestColor(r, g, b, palette) {
  let best = palette[0], bestD = Infinity;
  for (const c of palette) {
    const dr = r - c[0], dg = g - c[1], db = b - c[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Core API.
// ---------------------------------------------------------------------------
/**
 * @param {File|Blob|HTMLImageElement|string} source
 * @param {object} [opts]
 * @param {number} [opts.grid=48]     pixel resolution (NxN chunks). Lower = blockier.
 * @param {number} [opts.output=256]  final rendered size in px.
 * @param {string|string[]|null} [opts.palette=null]  'pico8'|'gameboy'|'sweet16'|hex[]|null
 * @param {boolean} [opts.dither=false] ordered dithering (only with a palette)
 * @param {boolean} [opts.circle=true]  circular crop for profile bubbles
 * @param {number} [opts.contrast=1]    1 = none; try 1.1–1.3 to pop before quantizing
 * @param {number} [opts.saturate=1]    1 = none; try 1.2–1.5 for punchier, less washed-out colour
 * @param {'image/png'|'image/webp'} [opts.type='image/png']
 * @returns {Promise<{dataURL:string, blob:Blob, canvas:HTMLCanvasElement, grid:number}>}
 */
async function pixelize(source, opts = {}) {
  const {
    grid = 48,
    output = 256,
    palette = null,
    dither = false,
    circle = true,
    contrast = 1,
    saturate = 1,
    type = 'image/png',
  } = opts;

  const img = await loadImage(source);

  // 1. Center square-crop the source (cover).
  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const sx = ((img.naturalWidth || img.width) - side) / 2;
  const sy = ((img.naturalHeight || img.height) - side) / 2;

  // 2. Downscale into a tiny grid×grid canvas. Smoothing ON = area averaging.
  const small = document.createElement('canvas');
  small.width = small.height = grid;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, sx, sy, side, side, 0, 0, grid, grid);

  // 3. Per-pixel processing: contrast, saturation, optional palette + dither.
  const pal = Array.isArray(palette)
    ? palette.map(hexToRgb)
    : (palette && PALETTES[palette]) ? PALETTES[palette].map(hexToRgb) : null;

  if (contrast !== 1 || saturate !== 1 || pal) {
    const imgData = sctx.getImageData(0, 0, grid, grid);
    const d = imgData.data;
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const i = (y * grid + x) * 4;
        let r = d[i], g = d[i + 1], b = d[i + 2];

        if (contrast !== 1) {
          r = clamp((r - 128) * contrast + 128);
          g = clamp((g - 128) * contrast + 128);
          b = clamp((b - 128) * contrast + 128);
        }

        if (saturate !== 1) {
          // Push each channel away from luma — punchier colour reads as
          // deliberate pixel art rather than a washed-out mosaic.
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          r = clamp(lum + (r - lum) * saturate);
          g = clamp(lum + (g - lum) * saturate);
          b = clamp(lum + (b - lum) * saturate);
        }

        if (pal) {
          if (dither) {
            const t = (BAYER4[y & 3][x & 3] / 16 - 0.5) * 48; // spread
            r = clamp(r + t); g = clamp(g + t); b = clamp(b + t);
          }
          const c = nearestColor(r, g, b, pal);
          r = c[0]; g = c[1]; b = c[2];
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    }
    sctx.putImageData(imgData, 0, 0);
  }

  // 4. Nearest-neighbor upscale to the output canvas = crisp square pixels.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = output;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, grid, grid, 0, 0, output, output);

  // 5. Optional circular mask for profile bubbles.
  if (circle) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(output / 2, output / 2, output / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  const blob = await new Promise((res) => canvas.toBlob(res, type));
  const dataURL = canvas.toDataURL(type);
  return { dataURL, blob, canvas, grid };
}

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// ---------------------------------------------------------------------------
// Drop-in helper for the "click the circle → pick a photo → it appears
// pixelised" flow. Wires a file input to an <img> preview automatically.
// ---------------------------------------------------------------------------
/**
 * @param {HTMLInputElement} inputEl  a <input type="file" accept="image/*">
 * @param {HTMLImageElement} previewEl the avatar <img> to update
 * @param {object} [opts] same options as pixelize(), plus:
 * @param {(result:{dataURL,blob})=>void} [opts.onResult] callback after each pick
 */
function attachAvatarPicker(inputEl, previewEl, opts = {}) {
  const { onResult, ...pixOpts } = opts;
  inputEl.addEventListener('change', async () => {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;
    const result = await pixelize(file, pixOpts);
    if (previewEl) previewEl.src = result.dataURL;
    if (onResult) onResult(result);
  });
  return inputEl;
}

// ---------------------------------------------------------------------------
// Universal export.
// ---------------------------------------------------------------------------
const PixelAvatar = { pixelize, attachAvatarPicker, PALETTES };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PixelAvatar;
}
if (typeof window !== 'undefined') {
  window.PixelAvatar = PixelAvatar;
}

export { pixelize, attachAvatarPicker, PALETTES };
export default PixelAvatar;
