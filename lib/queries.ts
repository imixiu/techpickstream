import { query } from "./db";
import { SITE } from "./db";
import { Article, ArticlePreview, Author } from "./types";

function formatDate(date: unknown): string | null {
  if (!date) return null;
  if (date instanceof Date) return date.toISOString().split("T")[0];
  return String(date).split("T")[0];
}

function mapPreview(row: any): ArticlePreview {
  return {
    id: row.id,
    slug: row.short_title,
    site: row.site,
    type: row.type,
    title: row.title,
    description: row.description,
    img: row.img,
    author: row.author,
    publishDate: formatDate(row.published_time),
    tag: row.tag ?? null,
    isOnline: row.is_online ?? "Y",
  };
}

export async function getAllArticles(): Promise<ArticlePreview[]> {
  const rows = await query(
    `SELECT id, short_title, site, type, title, description, img, author, published_time, tag, is_online
     FROM articles WHERE site = ? AND is_online = 'Y' ORDER BY published_time DESC`,
    [SITE]
  );
  return (rows as any[]).map(mapPreview);
}

export async function getArticlesByCategory(category: string, page = 1, pageSize = 24): Promise<{ articles: ArticlePreview[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const [rows, countRows] = await Promise.all([
    query(
      `SELECT id, short_title, site, type, title, description, img, author, published_time, tag, is_online
       FROM articles WHERE site = ? AND type = ? AND is_online = 'Y'
       ORDER BY published_time DESC LIMIT ? OFFSET ?`,
      [SITE, category, pageSize, offset]
    ),
    query(
      `SELECT COUNT(*) as count FROM articles WHERE site = ? AND type = ? AND is_online = 'Y'`,
      [SITE, category]
    ),
  ]);
  const total = parseInt(((countRows as any[])[0] as any).count, 10);
  return { articles: (rows as any[]).map(mapPreview), total };
}

export async function getArticle(category: string, slug: string): Promise<Article | null> {
  const rows = await query(
    `SELECT * FROM articles WHERE site = ? AND type = ? AND short_title = ? AND is_online = 'Y' LIMIT 1`,
    [SITE, category, slug]
  );
  if ((rows as any[]).length === 0) return null;
  const row = (rows as any[])[0] as any;
  return {
    id: row.id,
    slug: row.short_title,
    site: row.site,
    type: row.type,
    title: row.title,
    description: row.description,
    img: row.img,
    author: row.author,
    publishDate: formatDate(row.published_time),
    body: row.body,
    url: row.url,
    language: row.language,
    updatedAt: row.modified_time ? formatDate(row.modified_time) ?? undefined : undefined,
    tag: row.tag ?? null,
    isOnline: row.is_online ?? "Y",
  };
}

export async function getFeaturedArticle(): Promise<ArticlePreview | null> {
  const rows = await query(
    `SELECT id, short_title, site, type, title, description, img, author, published_time, tag, is_online
     FROM articles WHERE site = ? AND img IS NOT NULL AND is_online = 'Y'
     ORDER BY published_time DESC LIMIT 1`,
    [SITE]
  );
  if ((rows as any[]).length === 0) return null;
  return mapPreview((rows as any[])[0]);
}

export async function getRelatedArticles(category: string, excludeId: number): Promise<ArticlePreview[]> {
  const rows = await query(
    `SELECT id, short_title, site, type, title, description, img, author, published_time, tag, is_online
     FROM articles WHERE site = ? AND type = ? AND id != ? AND is_online = 'Y'
     ORDER BY published_time DESC LIMIT 3`,
    [SITE, category, excludeId]
  );
  return (rows as any[]).map(mapPreview);
}

export async function getAllAuthors(): Promise<Author[]> {
  const rows = await query(
    `SELECT * FROM authors WHERE site = ? ORDER BY id`,
    [SITE]
  );
  return (rows as any[]) as Author[];
}

export async function getAuthorBySlug(slug: string): Promise<Author | null> {
  const rows = await query(
    `SELECT * FROM authors WHERE site = ? AND slug = ? LIMIT 1`,
    [SITE, slug]
  );
  if ((rows as any[]).length === 0) return null;
  return (rows as any[])[0] as Author;
}

export async function getArticlesByAuthor(authorName: string): Promise<ArticlePreview[]> {
  // Match by name OR slug (articles.author may store either)
  const rows = await query(
    `SELECT id, short_title, site, type, title, description, img, author, published_time, tag, is_online
     FROM articles WHERE site = ? AND (author = ? OR author = ?) AND is_online = 'Y'
     ORDER BY published_time DESC`,
    [SITE, authorName, authorName.toLowerCase().replace(/\s+/g, '-')]
  );
  return (rows as any[]).map(mapPreview);
}

export async function getArticleCount(): Promise<number> {
  const rows = await query(
    `SELECT COUNT(*) as count FROM articles WHERE site = ? AND is_online = 'Y'`,
    [SITE]
  );
  return parseInt(((rows as any[])[0] as any).count, 10);
}

export async function getCategoryCount(): Promise<number> {
  const rows = await query(
    `SELECT COUNT(DISTINCT type) as count FROM articles WHERE site = ? AND is_online = 'Y'`,
    [SITE]
  );
  return parseInt(((rows as any[])[0] as any).count, 10);
}

export async function getAuthorCount(): Promise<number> {
  const rows = await query(
    `SELECT COUNT(*) as count FROM authors WHERE site = ?`,
    [SITE]
  );
  return parseInt(((rows as any[])[0] as any).count, 10);
}
