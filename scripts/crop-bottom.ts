import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';

async function main(): Promise<void> {
  const src = readFileSync('__tests__/fixtures/receipts/1000009049.jpg');
  const meta = await sharp(src).rotate().metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  console.log('dimensions after EXIF rotation:', w, 'x', h);

  // Tight crop of just the rightmost ~15% — that's where the totals + summary sit.
  // No downsize — keep native resolution for legibility.
  const cropLeft = Math.floor(w * 0.78);
  const cropWidth = Math.floor(w * 0.18);

  const totalsCrop = await sharp(src)
    .rotate()
    .extract({ left: cropLeft, top: 0, width: cropWidth, height: h })
    .rotate(-90)
    .jpeg({ quality: 95 })
    .toBuffer();
  writeFileSync('/tmp/receipt-totals.jpg', totalsCrop);
  console.log('totals crop saved:', (totalsCrop.length / 1024).toFixed(0), 'KB');
}

main().catch((e) => { console.error(e); process.exit(1); });
