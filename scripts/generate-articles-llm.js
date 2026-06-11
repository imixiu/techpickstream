// Phase 2+3: Batch LLM article generation with v2 randomized prompts
const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');
const { neon } = require('@neondatabase/serverless');

// Secrets
const hexData = execSync('xxd -p .env.local', { encoding: 'utf8' }).replace(/\n/g, '');
const raw = Buffer.from(hexData, 'hex').toString('utf8');
const DB_URL = raw.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=');
const auth = JSON.parse(fs.readFileSync('/root/.hermes/auth.json', 'utf8'));
const KEYS = [
  auth.credential_pool.alibaba['1'].access_token,
  auth.credential_pool.alibaba['2'].access_token,
  auth.credential_pool.alibaba['3'].access_token,
  auth.credential_pool.alibaba['4'].access_token,
];
const sql = neon(DB_URL);
const SITE = 'techpickstream';

// Randomization pools
const TONES = [
  'analytical and data-driven, comparing specs and benchmarks',
  'conversational and opinionated, like a tech-savvy friend giving advice',
  'critical and sharp, pulling no punches on flaws',
  'enthusiastic and excitable, genuinely impressed by new tech',
  'measured and practical, focused on real-world value',
  'humorous and self-deprecating, making fun of tech industry hype',
  'nostalgic, comparing current tech to how things used to be',
  'skeptical, questioning marketing claims and looking past the hype',
];
const OPENINGS = [
  'Start with a bold claim that challenges a popular tech opinion.',
  'Open with a specific scenario — someone using this product in daily life.',
  'Begin with a direct question the reader probably has before buying.',
  'Open with a short, punchy one-sentence paragraph stating something unexpected.',
  'Start by describing a common misconception about this product category, then refute it.',
  'Open with a brief personal anecdote about testing or using a similar product.',
  'Begin with a comparison that seems odd at first but makes sense later.',
  'Start mid-review, as if you have been using the product for weeks and are sharing findings.',
  'Open with a price-to-value observation that frames the entire article.',
  'Begin by describing the problem this product solves, vividly.',
];
const STRUCTURES = [
  'Walk through setup, daily use, then verdict.',
  'Problem-solution: identify the issue, explore options, recommend what works.',
  'Comparison piece: constantly contrast two or more products/approaches.',
  'Organize by features rather than chronology.',
  'Build toward a recommendation: start with observations, layer evidence, conclude.',
  'Debunking: state the popular take, then systematically evaluate it.',
  'Guided tour: walk through key features and use cases one by one.',
];

const AUTHORS = ['Marcus Chen','Sarah Williams','James Park','Elena Rodriguez','David Kim','Rachel Foster','Alex Turner','Priya Sharma','Tom Bradley','TechPick Team'];
const AUTHOR_MAP = {
  'smartphones': ['Marcus Chen','Priya Sharma','Alex Turner'],
  'audio-gear': ['Sarah Williams','Tom Bradley','Alex Turner'],
  'wearables': ['James Park','Marcus Chen','Elena Rodriguez'],
  'smart-home': ['Elena Rodriguez','David Kim','Alex Turner'],
  'laptops-tablets': ['Rachel Foster','Alex Turner','Marcus Chen'],
  'gaming': ['David Kim','Tom Bradley','James Park'],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function buildSystemPrompt() {
  const tone = pick(TONES);
  const opening = pick(OPENINGS);
  const structure = pick(STRUCTURES);
  return `You are a writer for TechPickStream.com, a consumer electronics review site. Your voice is ${tone}.

Writing rules:
- ${opening}
- ${structure}
- Vary paragraph length. Mix short punchy paragraphs with longer analytical ones.
- Use first person occasionally ("I tested", "In my experience", "I noticed") to sound human.
- Include subjective opinions. Say "this works because" or "this disappoints because".
- Reference specific specs, features, price points, and real-world usage scenarios.
- Word count: let the topic determine length. Don't pad.
- Output HTML only (h2, h3, p, ul, ol, li, strong, em, blockquote, table). No markdown fences. No <html> or <body> tags.

STRICTLY FORBIDDEN:
- Never fabricate statistics, survey numbers, test results. Say "critics noted" instead of "87% of users".
- Never start with: "When...", "Since...", "At the...", "In the world of...", "For many...", "There is/are..."
- Never use: In conclusion, Delve into, Tapestry, Let's explore, rich tapestry, comprehensive guide, ultimate guide
- Never write a generic intro that could fit any article.`;
}

function buildUserPrompt(idea) {
  const hints = [
    'Keep this focused — around 800-1200 words.',
    'Medium-length, roughly 1200-1600 words.',
    'This deserves depth — 1500-2000 words.',
    'Let the topic breathe. Write as much or as little as it needs.',
  ];
  return `Title: ${idea.title}\nCategory: ${idea.type}\nBrief: ${idea.prompt}\n\n${pick(hints)}\n\nWrite like a real tech journalist, not a press release.`;
}

function callQwen(messages, maxTokens, keyIdx) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'qwen-plus',
      messages,
      max_tokens: maxTokens,
      temperature: 0.85,
    });
    const req = https.request('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEYS[keyIdx % KEYS.length]}` },
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

// Quality scoring
const FORBIDDEN = ['In conclusion','Comprehensive guide','Ultimate guide','Delve into','Navigating the world','Unveil the secrets',"In today's fast-paced",'Look no further',"Whether you're a beginner",'Dive deep into','Tapestry','Testament to','Embark on a journey','It is worth noting',"It's important to note","Let's explore",'In this article','This article will','We will explore','the world of','the realm of','the landscape of'];
const BANNED_OPENINGS = [/^when\s/i,/^since\s/i,/^at\s+(the|its|this)/i,/^in\s+(the\s+)?world\s/i,/^in\s+(the\s+)?realm/i,/^for\s+(many|most|decades|years)\s/i,/^there\s+(is|are|has\s+been|have\s+been)\s/i,/^it\s+(is|was|has\s+been)\s/i];

function scoreArticle(html) {
  let score = 85;
  const text = html.replace(/<[^>]+>/g, '').trim();
  if (FORBIDDEN.some(f => text.toLowerCase().includes(f.toLowerCase()))) score -= 20;
  if (text.length < 2000) score -= 15;
  const fp = text.split('\n\n')[0] || text.substring(0, 200);
  if (BANNED_OPENINGS.some(re => re.test(fp.trim()))) score -= 20;
  if (/^this\s+article/i.test(fp.trim())) score -= 15;
  const h2 = (html.match(/<h2/g) || []).length;
  const ul = (html.match(/<ul|<ol/g) || []).length;
  const bq = (html.match(/<blockquote/g) || []).length;
  if (h2 < 2) score -= 10;
  if (ul === 0 && bq === 0) score -= 10;
  const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 10).slice(0, 15);
  const starters = sentences.map(s => s.trim().split(/\s+/)[0].toLowerCase());
  const uniqueStarters = new Set(starters);
  if (uniqueStarters.size < starters.length * 0.5) score -= 15;
  if (/\b(I\s+(think|felt|tested|noticed|would\s+argue)|my\s+(take|experience|view))\b/i.test(text)) score += 5;
  return Math.max(0, Math.min(100, score));
}

// Concurrency control
let concurrency = 8;
let delay = 0;
let completed = 0;
let failed = 0;

async function generateArticle(idea, keyIdx) {
  const sysPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(idea);
  const maxTokens = randInt(2500, 6000);
  
  const html = await callQwen([
    { role: 'system', content: sysPrompt },
    { role: 'user', content: userPrompt },
  ], maxTokens, keyIdx);
  
  // Clean HTML
  let cleanHtml = html.trim();
  if (cleanHtml.startsWith('```')) cleanHtml = cleanHtml.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
  
  const score = scoreArticle(cleanHtml);
  const author = pick(AUTHOR_MAP[idea.type] || AUTHORS);
  
  // Generate title (45-60 chars) and description (140-160 chars)
  let title = idea.title;
  if (title.length > 60) title = title.substring(0, 57) + '...';
  let description = idea.prompt.substring(0, 155);
  if (description.length < 140) description = idea.title + '. ' + idea.prompt;
  if (description.length > 160) description = description.substring(0, 157) + '...';
  
  // Insert into DB
  await sql(
    `INSERT INTO articles (site, type, short_title, title, description, body, author, is_online, published_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (site, short_title) DO UPDATE SET body = $6, title = $4, description = $5, author = $7`,
    [SITE, idea.type, idea.slug, title, description, cleanHtml, author, 'Y']
  );
  
  return { slug: idea.slug, score, type: idea.type };
}

async function runBatch(ideas, startIdx) {
  const promises = [];
  for (let i = 0; i < Math.min(concurrency, ideas.length); i++) {
    const idea = ideas[i];
    const keyIdx = (startIdx + i) % KEYS.length;
    promises.push(
      generateArticle(idea, keyIdx)
        .then(r => ({ ok: true, ...r }))
        .catch(e => ({ ok: false, slug: idea.slug, error: e.message }))
    );
  }
  
  const results = await Promise.all(promises);
  
  for (const r of results) {
    if (r.ok) {
      completed++;
      if (completed % 10 === 0) {
        console.log(`  [${completed}/${ideas.length + completed - 1}] ${r.slug} score=${r.score}`);
      }
    } else {
      failed++;
      console.error(`  FAIL: ${r.slug} - ${r.error}`);
    }
  }
  
  return results.filter(r => r.ok).length;
}

async function main() {
  const ideas = JSON.parse(fs.readFileSync('article_ideas.json', 'utf8'));
  
  // Check which ones are already in DB
  const existing = await sql('SELECT short_title FROM articles WHERE site = $1', [SITE]);
  const existingSlugs = new Set(existing.map(r => r.short_title));
  
  const pending = ideas.filter(i => !existingSlugs.has(i.slug));
  console.log(`Total ideas: ${ideas.length}, Already in DB: ${existingSlugs.size}, Pending: ${pending.length}`);
  
  if (pending.length === 0) {
    console.log('All articles already generated!');
    return;
  }
  
  // Process in batches
  let processed = 0;
  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);
    const ok = await runBatch(batch, i);
    processed += batch.length;
    
    // Progress
    if (processed % 50 === 0 || i + concurrency >= pending.length) {
      console.log(`\nProgress: ${processed}/${pending.length} (${Math.round(processed/pending.length*100)}%) | OK: ${completed} | Failed: ${failed}`);
    }
    
    // Adaptive concurrency
    if (processed % 50 === 0) {
      const failRate = failed / Math.max(1, processed);
      if (failRate > 0.4) { concurrency = 1; delay = 5000; }
      else if (failRate > 0.2) { concurrency = 3; delay = 3000; }
      else if (failRate > 0.1) { concurrency = 5; delay = 0; }
      else { concurrency = 8; delay = 0; }
    }
    
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
  }
  
  console.log(`\n=== DONE ===`);
  console.log(`Completed: ${completed}, Failed: ${failed}`);
  
  // Verify DB count
  const final = await sql('SELECT COUNT(*) as cnt FROM articles WHERE site = $1 AND is_online = $2', [SITE, 'Y']);
  console.log(`Articles in DB: ${final[0].cnt}`);
}

main().catch(e => { console.error(e); process.exit(1); });
