import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { SITE } from '@/lib/db';
import { siteConfig } from '@/lib/site-config';

const SITE_URL = siteConfig.url;
const ARTICLES_PER_SITEMAP = 50000;

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ n: string }> }
) {
  const resolvedParams = await params;
  const match = resolvedParams.n.match(/^sitemap(\d+)\.xml$/);
  if (!match) {
    return new NextResponse('Invalid sitemap file', { status: 404 });
  }
  const pageNum = parseInt(match[1]);

  if (isNaN(pageNum) || pageNum < 1) {
    return new NextResponse('Invalid sitemap number', { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];
  const offset = (pageNum - 1) * ARTICLES_PER_SITEMAP;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  // Only in sitemap1: static pages (homepage, categories, authors, pagination)
  if (pageNum === 1) {
    // Homepage
    xml += `<url>\n<loc>${SITE_URL}/</loc>\n<lastmod>${today}</lastmod>\n<priority>1.0</priority>\n</url>\n`;

    // Category pages + pagination
    const PAGE_SIZE = 24;
    const categories = await query(
      `SELECT type, COUNT(*) as cnt FROM articles WHERE site = $1 AND is_online = 'Y' GROUP BY type`,
      [SITE]
    );
    for (const cat of categories) {
      xml += `<url>\n<loc>${SITE_URL}/${cat.type}</loc>\n<lastmod>${today}</lastmod>\n<priority>0.8</priority>\n</url>\n`;
      const pages = Math.ceil(parseInt(cat.cnt) / PAGE_SIZE);
      for (let p = 2; p <= pages; p++) {
        xml += `<url>\n<loc>${SITE_URL}/${cat.type}/page/${p}</loc>\n<lastmod>${today}</lastmod>\n<priority>0.6</priority>\n</url>\n`;
      }
    }

    // Author pages
    const authors = await query('SELECT slug FROM authors WHERE site = $1', [SITE]);
    for (const a of authors) {
      xml += `<url>\n<loc>${SITE_URL}/author/${a.slug}</loc>\n<lastmod>${today}</lastmod>\n<priority>0.6</priority>\n</url>\n`;
    }
  }

  // Article URLs
  const rows = await query(
    `SELECT type, short_title, published_time
     FROM articles
     WHERE site = $1 AND is_online = 'Y'
     ORDER BY published_time DESC
     LIMIT $2 OFFSET $3`,
    [SITE, ARTICLES_PER_SITEMAP, offset]
  );

  for (const row of rows) {
    const lastMod = row.published_time
      ? new Date(row.published_time).toISOString().split('T')[0]
      : today;
    xml += `<url>\n<loc>${SITE_URL}/${row.type}/${row.short_title}</loc>\n<lastmod>${lastMod}</lastmod>\n<priority>0.9</priority>\n</url>\n`;
  }

  xml += `</urlset>\n`;

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  });
}
