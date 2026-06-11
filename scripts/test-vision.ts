// Sanity-check the receipt vision prompt against real images before any UI
// work touches the app. Run from the repo root:
//
//   ANTHROPIC_API_KEY=sk-ant-... npx ts-node scripts/test-vision.ts <imagePath>
//
// or with .env loaded:
//
//   npx ts-node -r dotenv/config scripts/test-vision.ts <imagePath>
//
// You can pass multiple image paths to run them in sequence; prompt caching
// means runs 2+ share the cached system prompt.

import 'dotenv/config';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import { parseReceiptResponse } from '../services/receiptVision.node';

// Anthropic recommends long side <= 1568px for cost/quality balance and
// imposes a 10MB base64-size hard cap; we resize to fit comfortably under both.
const MAX_LONG_EDGE_PX = 1568;

async function prepareImage(path: string): Promise<{ base64: string; finalBytes: number; rawBytes: number }> {
  const raw = readFileSync(path);
  const resized = await sharp(raw)
    .rotate()              // honor EXIF orientation so vertical receipts stay vertical
    .resize({ width: MAX_LONG_EDGE_PX, height: MAX_LONG_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { base64: resized.toString('base64'), finalBytes: resized.length, rawBytes: raw.length };
}

async function processOne(apiKey: string, path: string): Promise<void> {
  const startedAt = Date.now();
  const { base64, finalBytes, rawBytes } = await prepareImage(path);

  process.stderr.write(`\n=== ${path} (raw ${(rawBytes / 1024 / 1024).toFixed(1)} MB → resized ${(finalBytes / 1024).toFixed(0)} KB) ===\n`);
  process.stderr.write('streaming: ');

  // Show a dot per text delta so the long parses are visibly making progress
  // without flooding stderr with raw JSON. Final structured output still goes
  // to stdout once the stream finishes and validates.
  let firstDeltaAt = 0;
  const receipt = await parseReceiptResponse(apiKey, base64, 'image/jpeg', {
    onTextDelta: () => {
      if (!firstDeltaAt) firstDeltaAt = Date.now();
      process.stderr.write('.');
    },
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const ttftSec = firstDeltaAt ? ((firstDeltaAt - startedAt) / 1000).toFixed(1) : '—';

  process.stderr.write(`\nparsed in ${elapsedSec}s (first token at ${ttftSec}s) · store=${receipt.store ?? '—'} · date=${receipt.purchaseDate ?? '—'} · ${receipt.items.length} items\n`);
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    process.stderr.write('Usage: npx ts-node scripts/test-vision.ts <imagePath> [<imagePath> ...]\n');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write('ANTHROPIC_API_KEY is not set in the environment.\n');
    process.exit(1);
  }

  for (const path of paths) {
    try {
      await processOne(apiKey, path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`FAILED on ${path}: ${msg}\n`);
      // Surface underlying cause (e.g. Anthropic API error body).
      if (e instanceof Error && 'cause' in e && e.cause) {
        const cause = e.cause as { message?: string; status?: number; error?: unknown };
        process.stderr.write(`  cause: ${cause.message ?? String(cause)}\n`);
        if (cause.error) {
          process.stderr.write(`  detail: ${JSON.stringify(cause.error).slice(0, 500)}\n`);
        }
      }
      // Continue to next image so one bad receipt doesn't kill the batch.
    }
  }
}

main();
