// Batch generate article cover images via Qwen + upload to Vercel Blob
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

const CATEGORY_PROMPTS = {
  'smartphones': 'A premium smartphone on a sleek dark surface with indigo and cyan accent lighting, product photography',
  'audio-gear': 'Premium wireless headphones and earbuds on a dark surface with moody purple and blue lighting, product photography',
  'wearables': 'Modern smartwatch and fitness tracker on a dark surface with teal and indigo accent lighting, product photography',
  'smart-home': 'Smart home devices including speaker, camera, and hub on a dark surface with warm and cool LED lighting',
  'laptops-tablets': 'Modern laptop and tablet on a clean dark desk with dramatic side lighting, professional tech photography',
  'gaming': 'Gaming setup with controller, headset, and monitor showing vibrant RGB lighting on dark background',
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
          else reject(new Error('No image'));
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
        else reject(new Error('Blob ' + res.statusCode + ': ' + d.substring(0,100)));
      });
    });
    req.on('error', reject); req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(buf); req.end();
  });
}

async function processArticle(article, keyIdx) {
  const basePrompt = CATEGORY_PROMPTS[article.type] || CATEGORY_PROMPTS['smartphones'];
  const prompt = `${basePrompt}. Editorial cover image for article: "${article.title}". Clean, modern, no text overlay.`;
  
  const imageUrl = await genImage(prompt, keyIdx);
  const buf = await download(imageUrl);
  const pathname = `covers/${SITE}/${article.short_title}.png`;
  const blobUrl = await blobUpload(buf, pathname);
  
  await sql('UPDATE articles SET img = $1 WHERE id = $2', [blobUrl, article.id]);
  return blobUrl;
}

async function main() {
  const BATCH = 4; // concurrency for images (slower than text)
  
  // Get articles without images
  const articles = await sql(
    `SELECT id, short_title, type, title FROM articles WHERE site = $1 AND is_online = 'Y' AND img IS NULL ORDER BY id`,
    [SITE]
  );
  
  const total = await sql('SELECT COUNT(*) as cnt FROM articles WHERE site = $1 AND is_online = $2', [SITE, 'Y']);
  const withImg = await sql('SELECT COUNT(*) as cnt FROM articles WHERE site = $1 AND is_online = $2 AND img IS NOT NULL', [SITE, 'Y']);
  
  console.log(`Total articles: ${total[0].cnt}, With images: ${withImg[0].cnt}, Pending: ${articles.length}`);
  
  if (articles.length === 0) {
    console.log('All articles have images!');
    return;
  }
  
  let processed = 0;
  let ok = 0;
  let fail = 0;
  
  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH);
    const promises = batch.map((a, j) => 
      processArticle(a, (i + j) % KEYS.length)
        .then(url => { ok++; return { ok: true, slug: a.short_title }; })
        .catch(e => { fail++; console.error(`  FAIL: ${a.short_title} - ${e.message}`); return { ok: false }; })
    );
    
    await Promise.all(promises);
    processed += batch.length;
    
    if (processed % 20 === 0 || i + BATCH >= articles.length) {
      console.log(`Progress: ${processed}/${articles.length} | OK: ${ok} | Failed: ${fail}`);
    }
    
    // Small delay between batches
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n=== DONE ===`);
  console.log(`Generated: ${ok}, Failed: ${fail}`);
  
  const finalCount = await sql('SELECT COUNT(*) as cnt FROM articles WHERE site = $1 AND is_online = $2 AND img IS NOT NULL', [SITE, 'Y']);
  console.log(`Articles with images: ${finalCount[0].cnt}/${total[0].cnt}`);
}

main().catch(e => { console.error(e); process.exit(1); });
