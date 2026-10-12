#!/usr/bin/env python3
"""
Universal image backfill — generates cover images for articles without them.
Reads IMAGE_PROMPTS from embedded config per site.
Usage: python3 batch_image_backfill.py --site <site> [--workers 10] [--batch-size 100] [--limit N]
"""
import os, sys, json, time, random, re, threading, ssl, argparse
import urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

def ensure_deps():
    try:
        import mysql.connector
    except ImportError:
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "mysql-connector-python", "-q"], check=True)
ensure_deps()
import mysql.connector

DASHSCOPE_KEY = ""
CDN_TOKEN = "alibaba-icbu-seo-image-to-alicdn-verify"
QWEN_IMG_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
CDN_URL = "https://ranking.alibaba.com/verticalSite/image2cdn.json"
DEFAULT_PROMPT = "Professional editorial photograph, clean composition, high quality"

def load_credentials():
    global DASHSCOPE_KEY, MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASS, MYSQL_DB
    env = {}
    with open("/root/public/content-pipeline/.env") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k] = v.strip()
    DASHSCOPE_KEY = env.get("DASHSCOPE_API_KEY", "")
    mysql_url = env.get("MYSQL_URL", "")
    without_proto = mysql_url.replace("mysql://", "")
    last_at = without_proto.rfind("@")
    user_pass = without_proto[:last_at]
    host_port_db = without_proto[last_at+1:]
    colon = user_pass.find(":")
    MYSQL_USER = user_pass[:colon]
    MYSQL_PASS = urllib.parse.unquote(user_pass[colon+1:])
    host_port, MYSQL_DB = host_port_db.split("/", 1)
    host, port = host_port.split(":")
    MYSQL_HOST = host
    MYSQL_PORT = int(port)

MYSQL_HOST = MYSQL_PORT = MYSQL_USER = MYSQL_PASS = MYSQL_DB = None
load_credentials()

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

IMAGE_PROMPTS = {}

def retry(fn, max_attempts=4, label=""):
    for attempt in range(max_attempts):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = min(10 * (2 ** attempt) + random.uniform(0, 5), 120)
                print(f"  warn {label} 429 rate-limited, attempt {attempt+1}/{max_attempts}, backoff {wait:.0f}s", flush=True)
                time.sleep(wait)
            else:
                if attempt == max_attempts - 1:
                    raise
                wait = (2 ** attempt) + random.uniform(0, 1)
                print(f"  warn {label} attempt {attempt+1} failed: {str(e)[:60]}, retry {wait:.1f}s", flush=True)
                time.sleep(wait)
        except Exception as e:
            if attempt == max_attempts - 1:
                raise
            wait = (2 ** attempt) + random.uniform(0, 1)
            print(f"  warn {label} attempt {attempt+1} failed: {str(e)[:60]}, retry {wait:.1f}s", flush=True)
            time.sleep(wait)
SENSITIVE_WORDS = [
    "nude", "nudes", "naked", "topless", "undressed", "bare",
    "soldier", "soldiers", "cannon", "cannons", "gun", "guns", "rifle", "rifles",
    "pistol", "pistols", "weapon", "weapons", "bomb", "bombs", "bullet", "bullets",
    "sword", "swords", "knife", "knives", "bayonet", "bayonets",
    "kill", "killed", "killing", "death", "dead", "blood", "bloody",
    "war", "battle", "attack", "fight", "combat", "military",
    "tobacco", "cigarette", "cigarettes", "smoking", "pipe",
    "alcohol", "liquor", "whiskey", "wine", "beer",
]

def sanitize_slug(slug):
    """Remove words that trigger DashScope content filter."""
    words = slug.replace("-", " ").replace("_", " ").split()
    cleaned = [w for w in words if w.lower() not in SENSITIVE_WORDS]
    return " ".join(cleaned) if cleaned else "decorative object"

def generate_image(article_type, slug):
    time.sleep(random.uniform(0, 3))
    base = IMAGE_PROMPTS.get(article_type, DEFAULT_PROMPT)
    topic = sanitize_slug(slug or "")
    prompt = f"{base}. Subject: {topic}" if topic else base
    # Try with slug first, then fall back to generic type-only prompt
    for attempt_prompt in [prompt, base]:
        payload = json.dumps({
            "model": "qwen-image-plus",
            "input": {"messages": [{"role": "user", "content": [{"text": attempt_prompt}]}]},
            "parameters": {"size": "1024*576"},
        }).encode()
        req = urllib.request.Request(QWEN_IMG_URL, data=payload,
            headers={"Authorization": f"Bearer {DASHSCOPE_KEY}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180, context=ssl_ctx) as resp:
                data = json.loads(resp.read())
            return data["output"]["choices"][0]["message"]["content"][0]["image"]
        except urllib.error.HTTPError as e:
            if e.code == 400 and attempt_prompt != base:
                # Content filter hit, retry with generic prompt
                continue
            raise

def upload_to_cdn(oss_url):
    encoded = urllib.parse.quote(oss_url, safe="")
    url = f"{CDN_URL}?url={encoded}&token={CDN_TOKEN}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=60, context=ssl_ctx) as resp:
        data = json.loads(resp.read())
    if data.get("code") != 200:
        raise ValueError(f"CDN error: {data}")
    return data["cdn_url"]

def get_mysql_conn():
    return mysql.connector.connect(
        host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER,
        password=MYSQL_PASS, database=MYSQL_DB, charset='utf8mb4')

def fetch_articles_without_images(site, limit=None):
    conn = get_mysql_conn()
    try:
        cur = conn.cursor(dictionary=True)
        query = "SELECT id, type, slug FROM articles WHERE site = %s AND (img IS NULL OR img = '') ORDER BY id"
        if limit:
            query += f" LIMIT {limit}"
        cur.execute(query, (site,))
        return cur.fetchall()
    finally:
        conn.close()

def update_article_image(article_id, img_url):
    conn = get_mysql_conn()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE articles SET img = %s, modified_time = NOW() WHERE id = %s", (img_url, article_id))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

def load_checkpoint(path):
    if path.exists():
        with open(path) as f:
            return set(json.load(f).get("completed", []))
    return set()

def save_checkpoint(path, completed):
    with open(path, "w") as f:
        json.dump({"completed": sorted(completed)}, f)

stats = {"success": 0, "failed": 0}
stats_lock = threading.Lock()

def process_one(article):
    article_id = article["id"]
    article_type = article["type"]
    slug = article["slug"] or ""
    try:
        oss_url = retry(lambda: generate_image(article_type, slug), max_attempts=3, label=f"id={article_id}")
        cdn_url = retry(lambda: upload_to_cdn(oss_url), max_attempts=2, label=f"cdn id={article_id}")
        ok = update_article_image(article_id, cdn_url)
        if ok:
            print(f"  OK id={article_id} {article_type}/{slug[:30]}", flush=True)
            with stats_lock: stats["success"] += 1
            return article_id
        else:
            with stats_lock: stats["failed"] += 1
            return None
    except Exception as e:
        print(f"  FAIL id={article_id}: {str(e)[:80]}", flush=True)
        with stats_lock: stats["failed"] += 1
        return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    parser.add_argument("--workers", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--max-rounds", type=int, default=3)
    args = parser.parse_args()

    site = args.site
    data_dir = Path(f"/data/vercel-projects/{site}/data")
    data_dir.mkdir(parents=True, exist_ok=True)
    ckpt_file = data_dir / "image_checkpoint.json"

    print(f"Workers: {args.workers} | Batch: {args.batch_size} | Max rounds: {args.max_rounds}", flush=True)

    start = time.time()
    for round_num in range(1, args.max_rounds + 1):
        print(f"\n{'='*60}", flush=True)
        print(f"Round {round_num}/{args.max_rounds} — fetching articles without images...", flush=True)

        articles = fetch_articles_without_images(site, args.limit)
        if not articles:
            print("No articles need images!", flush=True)
            break

        completed = load_checkpoint(ckpt_file)
        todo = [a for a in articles if a["id"] not in completed]
        print(f"Found {len(articles)} without images | Already done: {len(completed)} | To process: {len(todo)}", flush=True)

        if not todo:
            print("All done! Nothing left to process.", flush=True)
            break

        for batch_start in range(0, len(todo), args.batch_size):
            batch = todo[batch_start:batch_start + args.batch_size]
            batch_num = batch_start // args.batch_size + 1
            total_batches = (len(todo) + args.batch_size - 1) // args.batch_size
            print(f"\n  Batch {batch_num}/{total_batches}: {len(batch)} articles", flush=True)

            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                futures = {executor.submit(process_one, a): a for a in batch}
                for f in as_completed(futures):
                    result = f.result()
                    if result:
                        completed.add(result)

            save_checkpoint(ckpt_file, completed)
            print(f"  Batch done: {stats['success']} ok, {stats['failed']} fail (cumulative)", flush=True)
            if batch_start + args.batch_size < len(todo):
                time.sleep(2)

        # Re-check: are there still articles without images?
        remaining = fetch_articles_without_images(site, None)
        remaining_new = [a for a in remaining if a["id"] not in completed]
        print(f"\n  Round {round_num} complete. Remaining without images: {len(remaining_new)}", flush=True)

        if not remaining_new:
            print("  All articles have images. Done!", flush=True)
            break

        if round_num < args.max_rounds:
            print(f"  {len(remaining_new)} new articles found (likely inserted during generation). Starting next round...", flush=True)
            time.sleep(5)

    elapsed = time.time() - start
    rate = elapsed / max(stats["success"], 1)
    print(f"\n{'='*60}", flush=True)
    print(f"Done! Success: {stats['success']} Failed: {stats['failed']} Time: {elapsed/60:.1f}min Rate: {rate:.1f}s/img", flush=True)
    print(f"{'='*60}", flush=True)

if __name__ == "__main__":
    main()
