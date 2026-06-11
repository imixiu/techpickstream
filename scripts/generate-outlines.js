// Phase 1: Generate 500 unique article outlines - smaller batches
const https = require('https');
const fs = require('fs');

const auth = JSON.parse(fs.readFileSync('/root/.hermes/auth.json', 'utf8'));
const DASHSCOPE_KEY = auth.credential_pool.alibaba['1'].access_token;

const CATEGORIES = [
  { key: 'smartphones', label: 'Smartphones & Mobile', count: 85 },
  { key: 'audio-gear', label: 'Audio & Sound', count: 85 },
  { key: 'wearables', label: 'Wearables & Smartwatches', count: 83 },
  { key: 'smart-home', label: 'Smart Home & IoT', count: 83 },
  { key: 'laptops-tablets', label: 'Laptops & Tablets', count: 82 },
  { key: 'gaming', label: 'Gaming & Entertainment', count: 82 },
];

const BATCH_SIZE = 25;

function callQwen(messages, maxTokens = 4000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'qwen-plus',
      messages,
      max_tokens: maxTokens,
      temperature: 0.9,
    });
    const req = https.request('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DASHSCOPE_KEY}` },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.choices[0].message.content);
        } catch (e) { reject(new Error('Parse: ' + data.substring(0, 100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

async function generateBatch(category, batchNum, count) {
  const prompt = `Generate ${count} unique article ideas for the "${category.label}" category of TechPickStream (consumer electronics website).

For each, provide JSON: [{"title": "...", "slug": "...", "prompt": "2-3 sentence writing brief"}]

Rules:
- Specific titles with product names, numbers, or scenarios (no generic "Ultimate Guide")
- Slugs: lowercase-hyphens, max 55 chars
- Variety: reviews, comparisons, how-tos, buying guides, troubleshooting, first impressions
- Use real brands: Apple, Samsung, Sony, Google, Bose, JBL, OnePlus, etc.
- Cover budget, mid-range, and premium products

Output ONLY JSON array. No markdown.`;

  const response = await callQwen([
    { role: 'system', content: 'You are a tech content strategist. Output ONLY valid JSON arrays, no markdown fences.' },
    { role: 'user', content: prompt }
  ], 4000);

  let cleaned = response.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  
  // Try parsing, with recovery
  try {
    return JSON.parse(cleaned).map(i => ({ ...i, type: category.key }));
  } catch (e) {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]).map(i => ({ ...i, type: category.key })); } catch(e2) {}
    }
    // Try fixing truncated JSON - close any open strings and array
    const fixAttempt = cleaned + '"}]\n';
    try { return JSON.parse(fixAttempt).map(i => ({ ...i, type: category.key })); } catch(e3) {}
    console.error(`  Parse failed batch ${batchNum} for ${category.label}: ${e.message}`);
    return [];
  }
}

async function main() {
  // Load existing progress
  let allIdeas = [];
  if (fs.existsSync('article_ideas.json')) {
    try { allIdeas = JSON.parse(fs.readFileSync('article_ideas.json', 'utf8')); } catch(e) {}
  }
  
  // Count existing per category
  const existing = {};
  allIdeas.forEach(i => { existing[i.type] = (existing[i.type] || 0) + 1; });
  
  console.log(`Starting with ${allIdeas.length} existing ideas`);
  Object.entries(existing).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

  for (const cat of CATEGORIES) {
    const done = existing[cat.key] || 0;
    const remaining = cat.count - done;
    if (remaining <= 0) {
      console.log(`${cat.label}: already done (${done}/${cat.count})`);
      continue;
    }
    
    const batches = Math.ceil(remaining / BATCH_SIZE);
    console.log(`\n${cat.label}: need ${remaining} more in ${batches} batches`);
    
    for (let b = 0; b < batches; b++) {
      const batchCount = Math.min(BATCH_SIZE, remaining - b * BATCH_SIZE);
      console.log(`  Batch ${b+1}/${batches}: requesting ${batchCount} ideas...`);
      
      try {
        const ideas = await generateBatch(cat, b+1, batchCount);
        console.log(`  Got ${ideas.length} ideas`);
        allIdeas.push(...ideas);
        
        // Save progress
        fs.writeFileSync('article_ideas.json', JSON.stringify(allIdeas, null, 2));
      } catch (err) {
        console.error(`  Error: ${err.message}`);
      }
      
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  
  // Deduplicate
  const seen = new Set();
  const unique = allIdeas.filter(idea => {
    const key = idea.slug || idea.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  fs.writeFileSync('article_ideas.json', JSON.stringify(unique, null, 2));
  
  console.log(`\n=== FINAL ===`);
  console.log(`Total: ${unique.length} unique articles`);
  
  // Count per category
  const counts = {};
  unique.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
  Object.entries(counts).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
}

main().catch(e => { console.error(e); process.exit(1); });
