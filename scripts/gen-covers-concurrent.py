#!/usr/bin/env python3
"""
Batch generate cover images for techpickstream with configurable concurrency.
Qwen image-plus API → urllib download → Vercel Blob upload → DB update.

Usage:
  cd /root/vercel-projects/techpickstream
  python3 -u scripts/gen-covers-concurrent.py [CONCURRENCY]

Default concurrency: 5 workers.
"""

import os, sys, json, time, urllib.request, threading, tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ──
SITE = "techpickstream"
PROJECT_DIR = "/root/vercel-projects/techpickstream"
DASHSCOPE_KEY = "sk-b11580cc1fec4c2a814a8a97e3dfd7d1"
QWEN_API = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
IMAGE_SIZE = "1024*576"
CONCURRENCY = int(sys.argv[1]) if len(sys.argv) > 1 else 5
MAX_CONSECUTIVE_FAILURES = 20

# ── Category → visual theme mapping ──
CATEGORY_THEMES = {
    "audio-gear": "headphones, earbuds, speakers, audio equipment, studio setup, professional audio gear",
    "gaming": "gaming hardware, consoles, RGB lighting, gaming peripherals, controller, gaming setup",
    "wearables": "smartwatch, fitness tracker, wearable tech, health monitoring device, modern wearable",
    "smart-home": "smart home device, IoT gadget, home automation, smart speaker, connected home tech",
    "laptops-tablets": "laptop, tablet, ultrabook, productivity device, modern computer, sleek tech",
    "smartphones": "smartphone, mobile device, phone camera, mobile accessories, modern smartphone",
    "general": "technology product, electronic device, modern gadget, consumer electronics, tech innovation",
}

# ── Safe fallback prompts for content moderation retries ──
SAFE_PROMPTS = [
    "sleek modern technology device on clean desk, professional product photography, bright studio lighting",
    "minimalist tech gadget showcase, clean white background, professional editorial style",
    "contemporary electronic device display, modern aesthetic, soft shadows, professional lighting",
    "high-tech product photography, clean composition, bright background, editorial quality",
    "modern consumer electronics showcase, professional studio setup, clean design focus",
]

def load_env():
    env_path = os.path.join(PROJECT_DIR, ".env.local")
    if not os.path.exists(env_path):
        print(f"ERROR: {env_path} not found"); sys.exit(1)
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ[k] = v.strip().strip('"').strip("'")

load_env()
BLOB_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
DB_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
if not BLOB_TOKEN: print("ERROR: No BLOB token"); sys.exit(1)
if not DB_URL: print("ERROR: No DATABASE_URL"); sys.exit(1)

import psycopg2, psycopg2.pool

pool = psycopg2.pool.SimpleConnectionPool(1, CONCURRENCY + 2, DB_URL, sslmode="require")

stats = {"success": 0, "failed": 0, "content_blocked": 0, "total": 0}
stats_lock = threading.Lock()
start_time = time.time()

def get_articles():
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, slug, title, type FROM articles "
                "WHERE site = %s AND is_online = 'Y' AND (img IS NULL OR img = '') ORDER BY id",
                (SITE,))
            return cur.fetchall()
    finally:
        pool.putconn(conn)

def generate_image(title, category, attempt=0):
    theme = CATEGORY_THEMES.get(category, "professional editorial photography")
    if attempt == 0:
        prompt = f"Professional editorial blog cover: {title[:100]}. Theme: {theme}. Clean modern style, no text overlay, bright lighting."
    else:
        prompt = SAFE_PROMPTS[attempt % len(SAFE_PROMPTS)]

    payload = json.dumps({
        "model": "qwen-image-plus",
        "input": {"messages": [{"role": "user", "content": [{"text": prompt}]}]},
        "parameters": {"size": IMAGE_SIZE}
    }).encode()
    req = urllib.request.Request(QWEN_API, data=payload,
        headers={"Authorization": f"Bearer {DASHSCOPE_KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    return data["output"]["choices"][0]["message"]["content"][0]["image"]

def download(oss_url, path):
    urllib.request.urlretrieve(oss_url, path)
    if os.path.getsize(path) < 1024:
        raise ValueError(f"File too small ({os.path.getsize(path)}B)")

def upload_blob(path, slug):
    with open(path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        f"https://blob.vercel-storage.com/covers/{SITE}/{slug}.png",
        data=data,
        headers={"Authorization": f"Bearer {BLOB_TOKEN}", "x-content-type": "image/png",
                 "x-add-random-suffix": "true"}, method="PUT")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["url"]

def update_db(article_id, img_url):
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE articles SET img = %s WHERE id = %s", (img_url, article_id))
        conn.commit()
    finally:
        pool.putconn(conn)

def process_one(aid, slug, title, article_type):
    thread_id = threading.current_thread().name[-1]
    tmp_path = tempfile.mktemp(suffix=".png", prefix=f"cover-{aid}-t{thread_id}")
    try:
        oss_url = None
        for attempt in range(3):
            try:
                oss_url = generate_image(title, article_type, attempt)
                break
            except Exception as e:
                if "inappropriate" in str(e).lower() or "content" in str(e).lower():
                    continue
                raise
        if not oss_url:
            return (False, "content_blocked")

        download(oss_url, tmp_path)
        blob_url = upload_blob(tmp_path, slug)
        update_db(aid, blob_url)
        return (True, blob_url)
    except Exception as e:
        return (False, str(e)[:120])
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def main():
    articles = get_articles()
    total = len(articles)
    stats["total"] = total
    print(f"[{time.strftime('%H:%M:%S')}] Site: {SITE}", flush=True)
    print(f"[{time.strftime('%H:%M:%S')}] Articles without images: {total}", flush=True)
    print(f"[{time.strftime('%H:%M:%S')}] Concurrency: {CONCURRENCY}", flush=True)
    print(f"[{time.strftime('%H:%M:%S')}] Starting generation...", flush=True)

    with ThreadPoolExecutor(max_workers=CONCURRENCY, thread_name_prefix="gen") as executor:
        futures = {}
        for aid, slug, title, atype in articles:
            f = executor.submit(process_one, aid, slug, title, atype)
            futures[f] = (aid, slug, title, atype)

        for f in as_completed(futures):
            aid, slug, title, atype = futures[f]
            ok, detail = f.result()
            with stats_lock:
                if ok:
                    stats["success"] += 1
                else:
                    stats["failed"] += 1
                    if "content" in detail.lower() or "blocked" in detail.lower():
                        stats["content_blocked"] += 1
                done = stats["success"] + stats["failed"]
                elapsed = time.time() - start_time
                rate = done / elapsed if elapsed > 0 else 0
                remaining = (total - done) / rate if rate > 0 else 0
                status = "✓" if ok else "✗"
                if done % 50 == 0 or done <= 5 or not ok:
                    print(f"[{done}/{total}] {status} {slug[:50]} | "
                          f"OK:{stats['success']} Fail:{stats['failed']} Blocked:{stats['content_blocked']} | "
                          f"Rate:{rate:.2f}/s | ETA:{remaining/3600:.1f}h", flush=True)

    elapsed = time.time() - start_time
    print(f"\n=== COMPLETE ===", flush=True)
    print(f"Success: {stats['success']}", flush=True)
    print(f"Failed: {stats['failed']} (content-blocked: {stats['content_blocked']})", flush=True)
    print(f"Total: {total} | Time: {elapsed/60:.1f}min ({elapsed/3600:.1f}h)", flush=True)
    pool.closeall()

if __name__ == "__main__":
    main()
