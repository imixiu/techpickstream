// Generate sitemap for techpickstream
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const { execSync } = require('child_process');

const hexData = execSync('xxd -p .env.local', { encoding: 'utf8' }).replace(/\n/g, '');
const raw = Buffer.from(hexData, 'hex').toString('utf8');
const dbUrl = raw.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=');
const sql = neon(dbUrl);
const SITE = 'techpickstream';
const DOMAIN = 'https://techpickstream.com';

async function main() {
  const articles = await sql(
    `SELECT type, short_title, published_time FROM articles WHERE site = $1 AND is_online = 'Y' ORDER BY published_time DESC`,
    [SITE]
  );

  const categories = ['smartphones', 'audio-gear', 'wearables', 'smart-home', 'laptops-tablets', 'gaming'];
  const today = new Date().toISOString().split('T')[0];

  // Static pages
  const urls = [
    { loc: DOMAIN + '/', lastmod: today, priority: '1.0' },
    { loc: DOMAIN + '/author', lastmod: today, priority: '0.7' },
  ];

  // Category pages
  for (const cat of categories) {
    urls.push({ loc: `${DOMAIN}/${cat}`, lastmod: today, priority: '0.8' });
    // Pagination pages
    const catArticles = articles.filter(a => a.type === cat);
    const pages = Math.ceil(catArticles.length / 24);
    for (let p = 2; p <= pages; p++) {
      urls.push({ loc: `${DOMAIN}/${cat}/page/${p}`, lastmod: today, priority: '0.6' });
    }
  }

  // Article pages
  for (const a of articles) {
    const lastmod = a.published_time ? new Date(a.published_time).toISOString().split('T')[0] : today;
    urls.push({ loc: `${DOMAIN}/${a.type}/${a.short_title}`, lastmod, priority: '0.6' });
  }

  // Split into chunks of 5000 (sitemap limit)
  const CHUNK = 5000;
  const sitemaps = [];
  
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    const num = Math.floor(i / CHUNK) + 1;
    const filename = `sitemap${num}.xml`;
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const u of chunk) {
      xml += `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <priority>${u.priority}</priority>\n  </url>\n`;
    }
    xml += '</urlset>';
    
    fs.writeFileSync(`public/${filename}`, xml);
    sitemaps.push(filename);
    console.log(`Generated ${filename}: ${chunk.length} URLs`);
  }

  // Generate sitemap index
  let index = '<?xml version="1.0" encoding="UTF-8"?>\n';
  index += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const sm of sitemaps) {
    index += `  <sitemap>\n    <loc>${DOMAIN}/${sm}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>\n`;
  }
  index += '</sitemapindex>';
  
  fs.writeFileSync('public/sitemap.xml', index);
  console.log(`Generated sitemap.xml index: ${sitemaps.length} sitemaps`);
  console.log(`Total URLs: ${urls.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
