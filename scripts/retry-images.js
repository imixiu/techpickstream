// Retry failed cover images with sanitized prompts and key rotation
const https = require('https');
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const { neon } = require('@neondatabase/serverless');

function readEnvLine(key) {
  const hexData = execSync('xxd -p .env.local', { encoding: 'utf8' }).replace(/\n/g, '');
  const raw = Buffer.from(hexData, 'hex').toString('utf8');
  const line = raw.split('\n').find(l => l.startsWith(key + '='));
  return line ? line.split('=').slice(1).join('=') : null;
}

const auth = JSON.parse(fs.readFileSync('/root/.hermes/auth.json', 'utf8'));
const KEYS = [
  auth.credential_pool.alibaba['1'].access_token,
  auth.credential_pool.alibaba['2'].access_token,
  auth.credential_pool.alibaba['3'].access_token,
  auth.credential_pool.alibaba['4'].access_token,
];
const DB_URL = readEnvLine('DATABASE_URL');
const BLOB_TOKEN = readEnvLine('BLOB_READ_WRITE_TOKEN');
const SITE = 'techpickstream';
const sql = neon(DB_URL);

// Generic prompts per category (avoid brand names that trigger filters)
const SAFE_PROMPTS = {
  'smartphones': 'A modern smartphone with sleek design on a dark surface with dramatic indigo lighting, professional product photography, clean background, no text',
  'audio-gear': 'Premium wireless headphones and earbuds on a dark surface with moody purple lighting, professional product photography, clean background, no text',
  'wearables': 'Modern smartwatch on a wrist with dark background and teal accent lighting, professional product photography, no text',
  'smart-home': 'Smart home devices including speaker and hub on a dark surface with warm LED lighting, professional product photography, no text',
  'laptops-tablets': 'Modern laptop computer on a clean dark desk with dramatic side lighting, professional tech product photography, no text',
  'gaming': 'Gaming setup with controller and monitor showing vibrant RGB lighting on dark background, professional tech photography, no text',
};

function genImage(prompt, keyIdx) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'qwen-image-plus',
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: { size: '1024*576' }
    });
    const req = https.request('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS[keyIdx % KEYS.length]}` }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.output?.choices?.[0]?.message?.content?.[0]?.image) resolve(j.output.choices[0].message.content[0].image);
          else reject(new Error('No image in response'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body); req.end();
  });
}

function download(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return download(res.headers.location).then(resolve).catch(reject);
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function blobUpload(buf, pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'PUT', hostname: 'blob.vercel-storage.com', path: '/' + pathname,
      headers: {
        'Authorization': 'Bearer ' + BLOB_TOKEN, 'Content-Type': 'image/png',
        'Content-Length': buf.length, 'x-content-type': 'image/png', 'x-cache-control-max-age': '31536000',
      }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        if (res.statusCode < 300) { try { resolve(JSON.parse(d).url); } catch(e) { reject(e); } }
        else reject(new Error('Blob ' + res.statusCode));
      });
    });
    req.on('error', reject); req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(buf); req.end();
  });
}

async function main() {
  const BATCH = 3;
  
  const articles = await sql(
    `SELECT id, short_title, type, title FROM articles WHERE site = $1 AND is_online = 'Y' AND img IS NULL ORDER BY id`,
    [SITE]
  );
  
  const total = await sql('SELECT COUNT(*) as cnt FROM articles WHERE site = $1 AND is_online = $2', [SITE, 'Y']);
  
  console.log(`Total articles: ${total[0].cnt}, Without images: ${articles.length}`);
  
  if (articles.length === 0) { console.log('All have images!'); return; }

  let processed = 0, ok = 0, fail = 0;

  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH);
    const promises = batch.map((a, j) => {
      const safePrompt = SAFE_PROMPTS[a.type] || SAFE_PROMPTS['smartphones'];
      const keyIdx = (i + j) % KEYS.length;
      return (async () => {
        try {
          const imageUrl = await genImage(safePrompt, keyIdx);
          const buf = await download(imageUrl);
          const pathname = `covers/${SITE}/v2-${a.short_title}.png`;
          const blobUrl = await blobUpload(buf, pathname);
          await sql('UPDATE articles SET img = $1 WHERE id = $2', [blobUrl, a.id]);
          ok++;
        } catch(e) {
          fail++;
        }
      })();
    });
    
    await Promise.all(promises);
    processed += batch.length;
    
    if (processed % 20 === 0 || i + BATCH >= articles.length) {
      console.log(`Progress: ${processed}/${articles.length} | OK: ${ok} | Failed: ${fail}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n=== RETRY DONE ===`);
  console.log(`Generated: ${ok}, Still failed: ${fail}`);
  
  const finalCount = await sql('SELECT COUNT(*) as cnt FROM articles WHERE site = $1 AND is_online = $2 AND img IS NOT NULL', [SITE, 'Y']);
  console.log(`Articles with images: ${finalCount[0].cnt}/${total[0].cnt}`);
}

main().catch(e => { console.error(e); process.exit(1); });
