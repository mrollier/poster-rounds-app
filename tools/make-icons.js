// Draws the app icon (a yellow map pin on black) as PNG files, with no libraries.
//   node tools/make-icons.js      → icons/icon-192.png, icon-512.png, apple-touch-icon.png (180)
// The pin sits well inside the middle 80%, so Android may crop the icon to any shape ("maskable").
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = path.join(import.meta.dirname, "..", "icons");
const BG = [0, 0, 0], PIN = [255, 212, 0];

// Is the point (x, y), both 0…1, on the yellow part of the pin?
const C = { x: 0.5, y: 0.41 }, R = 0.2, TIP = { x: 0.5, y: 0.8 }, HOLE = 0.075;
const D = TIP.y - C.y, HALF = Math.asin(R / D); // the pin's sides touch the circle: cone from the tip
function onPin(x, y) {
  const dc = Math.hypot(x - C.x, y - C.y);
  if (dc <= HOLE) return false;               // the hole in the head
  if (dc <= R) return true;                    // the round head
  const vx = x - TIP.x, vy = y - TIP.y, len = Math.hypot(vx, vy);
  if (!len) return true;
  const along = -vy;                           // how far up from the tip, towards the head's centre
  // the sides stop where they touch the circle: at height (D² − R²) / D above the tip
  return along > 0 && along <= (D * D - R * R) / D && Math.acos(along / len) <= HALF;
}

function png(size) {
  const S = 4; // 4 × 4 samples per pixel for smooth edges
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3); // first byte: PNG filter type 0 (none)
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        if (onPin((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size)) hit++;
      }
      const a = hit / (S * S);
      for (let c = 0; c < 3; c++) row[1 + px * 3 + c] = Math.round(BG[c] + (PIN[c] - BG[c]) * a);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits per channel, RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180], ["favicon-32.png", 32]]) {
  fs.writeFileSync(path.join(OUT, name), png(size));
  console.log("wrote", name);
}
