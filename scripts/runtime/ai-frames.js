'use strict';
const fs = require('node:fs');
const path = require('node:path');
function removeBackgroundGreen(bitmap, width, height) {
  const reached = new Uint8Array(width * height), queue = new Uint32Array(width * height);
  let start = 0, end = 0;
  const eligible = pixel => {
    const at = pixel * 4, g = bitmap[at + 1], maximum = Math.max(bitmap[at], bitmap[at + 2]), alpha = bitmap[at + 3];
    // Bitmap colors are premultiplied. Classify in straight-color space so
    // faint green alpha fringes are not missed by an opaque-pixel threshold.
    return alpha <= 32 || g * 255 > 50 * alpha && (g - maximum) * 255 > 10 * alpha;
  };
  const visit = pixel => { if (!reached[pixel] && eligible(pixel)) { reached[pixel] = 1; queue[end++] = pixel; } };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { visit(y * width); visit(y * width + width - 1); }
  while (start < end) {
    const pixel = queue[start++], x = pixel % width;
    if (x) visit(pixel - 1); if (x + 1 < width) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width); if (pixel + width < reached.length) visit(pixel + width);
  }
  // Chroma keying is topological: enclosed green eyes/clothing are untouched.
  // Decontaminate the connected soft matte before resizing, so interpolation
  // never mixes an opaque green background back into neutral fur/whiskers.
  for (let pixel = 0; pixel < reached.length; pixel++) if (reached[pixel]) {
    const at = pixel * 4, g = bitmap[at + 1], maximum = Math.max(bitmap[at], bitmap[at + 2]), alpha = bitmap[at + 3];
    const excess = g - maximum;
    if (alpha <= 2 || g * 255 > 120 * alpha && excess * 255 > 55 * alpha || g * 255 > 60 * alpha && excess * 255 > 35 * alpha && g > 2 * maximum) bitmap.fill(0, at, at + 4);
    else if (excess * 255 > 10 * alpha) {
      const coverage = Math.max(0, 1 - excess / Math.max(1, alpha - maximum));
      bitmap[at + 1] = maximum;
      bitmap[at + 3] = Math.max(maximum, Math.round(alpha * coverage));
    }
  }
  return bitmap;
}
function createImageProcessor(nativeImage) {
  return async function processImage({ bytes, action, directory }) {
    // Reject PNG dimension bombs before the native decoder allocates pixels.
    // Compatible endpoints can return JPEG: its decoded size is checked below.
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      if (bytes.toString('ascii', 12, 16) !== 'IHDR') throw Error('生成图片格式不正确。');
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (width < 4 || height < 3 || width > 8192 || height > 8192 || width * height > 32 * 1024 * 1024) throw Error('生成图片尺寸不正确。');
    }
    const source = nativeImage.createFromBuffer(bytes);
    if (source.isEmpty()) throw Error('无法读取生成的图片。');
    const size = source.getSize();
    if (size.width < 4 || size.height < 3 || size.width > 8192 || size.height > 8192 || size.width * size.height > 32 * 1024 * 1024) throw Error('生成图片尺寸不正确。');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Save the genuine model output separately; playback uses extracted PNGs.
    fs.writeFileSync(path.join(directory, 'source.png'), source.toPNG(), { mode: 0o600 });
    const count = action === 'base' ? 1 : 12;
    const cells = [];
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? 0 : Math.round(i % 4 * size.width / 4);
      const y = count === 1 ? 0 : Math.round(Math.floor(i / 4) * size.height / 3);
      const right = count === 1 ? size.width : Math.round((i % 4 + 1) * size.width / 4);
      const bottom = count === 1 ? size.height : Math.round((Math.floor(i / 4) + 1) * size.height / 3);
      cells.push(source.crop({ x, y, width: right - x, height: bottom - y }));
    }
    const maximum = cells.reduce((m, c) => ({ width: Math.max(m.width, c.getSize().width), height: Math.max(m.height, c.getSize().height) }), { width: 0, height: 0 });
    const scale = Math.min(480 / maximum.width, 480 / maximum.height);
    const frames = [];
    for (let i = 0; i < cells.length; i++) {
      const dimensions = cells[i].getSize();
      const width = Math.round(dimensions.width * scale), height = Math.round(dimensions.height * scale);
      const clean = removeBackgroundGreen(cells[i].toBitmap(), dimensions.width, dimensions.height);
      const tile = nativeImage.createFromBitmap(clean, dimensions).resize({ width, height, quality: 'best' });
      // Resolve low-alpha rounding fringes introduced by native resampling too.
      const bitmap = removeBackgroundGreen(tile.toBitmap(), width, height), canvas = Buffer.alloc(512 * 512 * 4);
      const left = Math.floor((512 - width) / 2), top = Math.floor((512 - height) / 2);
      // toBitmap/createFromBitmap share the platform's pixel representation;
      // only the green and alpha components change (R/B stay untouched).
      // One global transform preserves generated position and scale variation.
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4;
        bitmap.copy(canvas, ((y + top) * 512 + x + left) * 4, src, src + 4);
      }
      const frame = path.join(directory, `${String(i + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(frame, nativeImage.createFromBitmap(canvas, { width: 512, height: 512 }).toPNG(), { mode: 0o600 });
      frames.push(frame);
    }
    return { image: frames[0], frames };
  };
}
module.exports = { createImageProcessor, removeBackgroundGreen };
