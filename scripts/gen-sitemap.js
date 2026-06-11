// gen-sitemap.js — DEPRECATED
// Sitemaps are now handled by dynamic routes:
//   /sitemap/sitemapindex.xml  → sitemap index (static.xml + sitemap1.xml ...)
//   /sitemap/static.xml        → homepage, categories, authors, pagination
//   /sitemap/sitemap1.xml      → article URLs
//   /sitemap/[n].xml           → article URLs (paginated)
//
// No need to run this script. robots.txt points to /sitemap/sitemapindex.xml.
console.log("Sitemaps are now served via dynamic routes. No action needed.");
console.log("See: app/sitemap/sitemapindex.xml/route.ts");
console.log("     app/sitemap/static.xml/route.ts");
console.log("     app/sitemap/[n]/route.ts");
