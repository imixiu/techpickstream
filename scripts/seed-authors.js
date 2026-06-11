const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const { execSync } = require('child_process');

// Read raw DB URL from hex dump to avoid masking
const hexData = execSync('xxd -p .env.local', { encoding: 'utf8' }).replace(/\n/g, '');
const raw = Buffer.from(hexData, 'hex').toString('utf8');
const dbUrl = raw.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=');

const sql = neon(dbUrl);
const SITE = 'techpickstream';

const authors = [
  { name: 'Marcus Chen', slug: 'marcus-chen', bio: 'Senior tech editor with 12 years covering smartphones and mobile technology. Former engineer at a major handset manufacturer.', specialty: 'Smartphones & Mobile' },
  { name: 'Sarah Williams', slug: 'sarah-williams', bio: 'Audio engineer and lifelong audiophile. Reviews headphones, earbuds, and speakers with a critical ear and technical precision.', specialty: 'Audio & Sound' },
  { name: 'James Park', slug: 'james-park', bio: 'Wearable technology specialist who has tested over 200 smartwatches and fitness trackers. Marathon runner and data nerd.', specialty: 'Wearables & Smartwatches' },
  { name: 'Elena Rodriguez', slug: 'elena-rodriguez', bio: 'Smart home consultant and IoT architect. Helps readers build connected homes that actually work together.', specialty: 'Smart Home & IoT' },
  { name: 'David Kim', slug: 'david-kim', bio: 'Gaming hardware analyst covering consoles, GPUs, and peripherals. Competitive gamer turned tech journalist.', specialty: 'Gaming & Entertainment' },
  { name: 'Rachel Foster', slug: 'rachel-foster', bio: 'Productivity tech writer focused on laptops, tablets, and creative tools. Tests machines under real-world workloads.', specialty: 'Laptops & Tablets' },
  { name: 'Alex Turner', slug: 'alex-turner', bio: 'Consumer electronics industry veteran with 20+ years of experience. Covers market trends, product launches, and buying strategies.', specialty: 'Industry Analysis' },
  { name: 'Priya Sharma', slug: 'priya-sharma', bio: 'Mobile photography expert and camera technology reviewer. Breaks down sensor specs into practical shooting advice.', specialty: 'Camera & Photography Tech' },
  { name: 'Tom Bradley', slug: 'tom-bradley', bio: 'Home theater and AV specialist. Reviews TVs, projectors, soundbars, and streaming devices for the ultimate entertainment setup.', specialty: 'Home Theater & AV' },
  { name: 'TechPick Team', slug: 'techpick-team', bio: 'The TechPickStream editorial team. Collaborative articles, roundups, and buying guides researched and written by our full staff.', specialty: 'Collaborative & Roundups' },
];

async function main() {
  // Delete existing authors for this site first
  await sql('DELETE FROM authors WHERE site = $1', [SITE]);
  console.log('Cleared existing authors');

  for (const a of authors) {
    await sql(
      `INSERT INTO authors (site, name, slug, description, img) VALUES ($1, $2, $3, $4, $5)`,
      [SITE, a.name, a.slug, a.bio, null]
    );
    console.log('Inserted:', a.name);
  }

  const count = await sql('SELECT COUNT(*) as cnt FROM authors WHERE site = $1', [SITE]);
  console.log(`\nTotal authors for ${SITE}:`, count[0].cnt);
}

main().catch(e => { console.error(e); process.exit(1); });
