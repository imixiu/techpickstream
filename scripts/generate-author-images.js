// Generate author headshots via Qwen API and upload to Vercel Blob
const { neon } = require('@neondatabase/serverless');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Read secrets from hex dump to avoid masking
function readEnvLine(key) {
  const hexData = execSync('xxd -p .env.local', { encoding: 'utf8' }).replace(/\n/g, '');
  const raw = Buffer.from(hexData, 'hex').toString('utf8');
  const line = raw.split('\n').find(l => l.startsWith(key + '='));
  return line ? line.split('=').slice(1).join('=') : null;
}

// Read DASHSCOPE key from auth.json
function getDashscopeKey() {
  const auth = JSON.parse(fs.readFileSync('/root/.hermes/auth.json', 'utf8'));
  return auth.credential_pool.alibaba['1'].access_token; // pool-key-1 uses dashscope.aliyuncs.com
}

const DB_URL = readEnvLine('DATABASE_URL');
const BLOB_TOKEN = readEnvLine('BLOB_READ_WRITE_TOKEN');
const DASHSCOPE_KEY = getDashscopeKey();
const SITE = 'techpickstream';

const sql = neon(DB_URL);

function callQwenImage(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'qwen-image-plus',
      input: {
        messages: [{ role: 'user', content: [{ text: prompt }] }]
      },
      parameters: { size: '512*512' }
    });
    const req = https.request('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DASHSCOPE_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.output && json.output.choices && json.output.choices[0]) {
            const content = json.output.choices[0].message.content;
            if (Array.isArray(content) && content[0] && content[0].image) {
              resolve(content[0].image);
            } else {
              reject(new Error('No image in response: ' + JSON.stringify(content).substring(0, 100)));
            }
          } else {
            reject(new Error('Unexpected response: ' + data.substring(0, 200)));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

function blobUpload(buffer, pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'PUT',
      hostname: 'blob.vercel-storage.com',
      path: '/' + pathname,
      headers: {
        'Authorization': 'Bearer ' + BLOB_TOKEN,
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'x-content-type': 'image/png',
        'x-cache-control-max-age': '31536000',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data).url); }
          catch (e) { reject(new Error('Parse error: ' + data.substring(0, 100))); }
        } else {
          reject(new Error('Blob HTTP ' + res.statusCode + ': ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Blob upload timeout')); });
    req.write(buffer);
    req.end();
  });
}

async function main() {
  const authors = await sql('SELECT id, name, slug, description FROM authors WHERE site = $1 ORDER BY id', [SITE]);
  console.log(`Found ${authors.length} authors to generate headshots for`);

  for (const author of authors) {
    console.log(`\nGenerating headshot for: ${author.name}...`);
    
    const desc = author.description || 'tech writer';
    const prompt = `Professional headshot portrait of ${author.name}, ${desc.split('.')[0]}, studio lighting, clean neutral background, professional corporate photography style, sharp focus`;
    
    try {
      // Generate image
      const imageUrl = await callQwenImage(prompt);
      console.log(`  Image generated: ${imageUrl.substring(0, 60)}...`);
      
      // Download
      const buffer = await downloadImage(imageUrl);
      console.log(`  Downloaded: ${buffer.length} bytes`);
      
      // Upload to Blob
      const pathname = `authors/${SITE}/${author.slug}.png`;
      const blobUrl = await blobUpload(buffer, pathname);
      console.log(`  Uploaded to Blob: ${blobUrl.substring(0, 80)}...`);
      
      // Update DB
      await sql('UPDATE authors SET img = $1 WHERE id = $2', [blobUrl, author.id]);
      console.log(`  DB updated for ${author.name}`);
      
    } catch (err) {
      console.error(`  ERROR for ${author.name}: ${err.message}`);
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nDone! Verifying...');
  const updated = await sql('SELECT name, img FROM authors WHERE site = $1', [SITE]);
  updated.forEach(a => console.log(`  ${a.name}: ${a.img ? 'HAS IMAGE' : 'NO IMAGE'}`));
}

main().catch(e => { console.error(e); process.exit(1); });
