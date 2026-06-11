import 'dotenv/config';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

  const src = readFileSync('__tests__/fixtures/receipts/1000009049.jpg');
  // Use higher resolution than the parse script (1568) so the small totals
  // text near the bottom is legible. Stays under the 10MB base64 cap.
  const resized = await sharp(src)
    .rotate()
    .resize({ width: 3500, height: 3500, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  console.log('image size:', (resized.length / 1024 / 1024).toFixed(2), 'MB');

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: resized.toString('base64') } },
        { type: 'text', text: 'This is a Whole Foods receipt. Near the totals section there is a line labeled "Sold Items:" followed by a number. Find that exact line and report the number printed on it. Also report the exact surrounding text (subtotal, tax, total, etc.) so I can verify.' },
      ],
    }],
  });

  for (const c of response.content) {
    if (c.type === 'text') process.stdout.write(c.text + '\n');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
