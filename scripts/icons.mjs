// Generate bundled PNG extension icons. No remote assets or image dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../extension/icons/', import.meta.url));
mkdirSync(directory, { recursive: true });
function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) { crc ^= value; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type); const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, crc]);
}
function inside(x, y, points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = points[i], [c, d] = points[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit;
  }
  return hit;
}
const star = [[33,12],[38,25],[52,32],[38,37],[33,52],[27,38],[13,32],[27,26]];
const small = [[49,10],[51,14],[55,16],[51,18],[49,22],[47,18],[43,16],[47,14]];
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const total = [0,0,0,0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) * 64 / size, py = (y + (sy + .5) / 4) * 64 / size;
      const dx = Math.max(15 - px, px - 49, 0), dy = Math.max(15 - py, py - 49, 0);
      const rgba = dx * dx + dy * dy > 225 ? [0,0,0,0] : inside(px, py, small) ? [255,255,255,255] : inside(px, py, star) ? [241,244,197,255] : [35,92,70,255];
      rgba.forEach((v, i) => { total[i] += v; });
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    total.forEach((v, i) => { pixels[offset + i] = Math.round(v / 16); });
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(`${directory}/icon${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
console.log('Generated four bundled PNG icons.');