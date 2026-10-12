#!/usr/bin/env python3
"""
techpickstream batch article generator.
Supports --count and --site args from orchestrator.
"""
import os, sys, json, time, random, re, threading, ssl, argparse
import urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta
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

SITE = "techpickstream"
TARGET = 10000
WORKERS = 10
DASHSCOPE_KEY = ""
CDN_TOKEN="alibaba-icbu-seo-image-to-alicdn-verify"
QWEN_CHAT_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_IMG_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
CDN_URL = "https://ranking.alibaba.com/verticalSite/image2cdn.json"

TYPES = ["audio-gear", "gaming", "general", "laptops-tablets", "smart-home", "smartphones", "wearables"]
AUTHORS = ["Nina Walsh", "Hannah Cole", "Sophia Lin", "Marcus Reid", "Tom Hartley", "Michael Brooks", "Diana Kowalski", "Ryan Tanaka", "Noah Carter"]

parser = argparse.ArgumentParser()
parser.add_argument("--count", type=int, default=TARGET)
parser.add_argument("--site", type=str, default=SITE)
args = parser.parse_args()
TARGET = args.count
SITE = args.site

PROJECT_DIR = Path(f"/data/vercel-projects/{SITE}")
DATA_DIR = PROJECT_DIR / "data"
OUTPUT_DIR = PROJECT_DIR / "output"

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

ROLE_MAP = {
    "audio-gear": "Audio Gear audio specialist and sound engineer",
    "gaming": "Gaming expert with 10+ years of professional experience",
    "general": "General expert with 10+ years of professional experience",
    "laptops-tablets": "Laptops Tablets expert with 10+ years of professional experience",
    "smart-home": "Smart Home home improvement expert and interior designer",
    "smartphones": "Smartphones art expert and creative professional",
    "wearables": "Wearables expert with 10+ years of professional experience"
}

IMAGE_PROMPTS = {}
for t in TYPES:
    IMAGE_PROMPTS[t] = f"Professional photography of {t.replace('-', ' ')} topics, high quality"

def classify_slug(slug):
    return random.choice(TYPES)

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

def parse_article_json(content):
    content = re.sub(r'^```(?:json)?\s*', '', content.strip())
    content = re.sub(r'\s*```$', '', content.strip())
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    match = re.search(r'\{[\s\S]*\}', content)
    if match:
        text = match.group()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            try:
                fixed = re.sub(r'\\(?![\"/bfnrtu])', r'\\\\', text)
                return json.loads(fixed)
            except json.JSONDecodeError:
                pass
            try:
                fixed = text.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
                fixed = fixed.replace('\\\\n', '\\n').replace('\\\\r', '\\r').replace('\\\\t', '\\t')
                return json.loads(fixed)
            except json.JSONDecodeError:
                pass
            truncated = text.rstrip()
            if not truncated.endswith('}'):
                for suffix in ['"\}','"\}', '\]}', ']', '}']:
                    try:
                        return json.loads(truncated + suffix)
                    except json.JSONDecodeError:
                        continue
    raise ValueError(f"Cannot parse JSON ({len(content)} chars)")

def build_prompt(type_name, keyword):
    role = ROLE_MAP.get(type_name, "professional writer")
    topic = keyword.replace('-', ' ').title()
    return f"""You are a {role}. Write a high-quality, informative blog article about: {topic}

REQUIREMENTS:
- Output ONLY valid JSON: {{"shortTitle": "{keyword}", "title": "...", "description": "...", "article": "..."}}
- article: Full HTML body (1800+ words)
- 5-8 <h2> headings, 3-5 <h3> subheadings, 15+ <p> paragraphs
- 2+ <ul>/<ol> lists, 1+ <table> in <div class="tableContainer">
- NO <img> tags anywhere
- NO <style> or <script> tags
- Include specific data points, real brand names, measurements
- First 100 words: clear summary
- Forbidden: "In conclusion", "Comprehensive guide", "Delve into", "Tapestry", "Embark on a journey"

OUTPUT (strict JSON, no markdown fences):
{{"shortTitle": "{keyword}", "title": "...", "description": "...", "article": "<h2>...</h2>..."}}"""

def generate_article(type_name, keyword):
    time.sleep(random.uniform(0, 2))
    prompt = build_prompt(type_name, keyword)
    payload = json.dumps({
        "model": "qwen-plus-latest",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 8000, "temperature": 0.8,
    }).encode()
    req = urllib.request.Request(QWEN_CHAT_URL, data=payload,
        headers={"Authorization": f"Bearer {DASHSCOPE_KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180, context=ssl_ctx) as resp:
        data = json.loads(resp.read())
    content = data["choices"][0]["message"]["content"]
    return parse_article_json(content)

def get_mysql_conn():
    return mysql.connector.connect(
        host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER,
        password=MYSQL_PASS, database=MYSQL_DB, charset='utf8mb4')

INSERT_SQL = """
INSERT IGNORE INTO articles
  (site, type, short_title, language, published_time, modified_time,
   author, img, title, description, url, body, tag, is_online, slug)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""

def insert_article(data):
    conn = get_mysql_conn()
    try:
        cur = conn.cursor()
        cur.execute(INSERT_SQL, (
            data['site'], data['type'], data['short_title'], data['language'],
            data['published_time'], data['modified_time'], data['author'],
            data['img'], data['title'], data['description'], data['url'],
            data['body'], data['tag'], data['is_online'], data['slug']))
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
successful_urls = []
urls_lock = threading.Lock()

def get_site_domain(site_name):
    try:
        with open("/root/.hermes/config/sites.json") as f:
            data = json.load(f)
        info = next((s for s in data.get("sites", []) if s.get("name") == site_name), None)
        return info.get("domain", "") if info else ""
    except:
        return ""

def get_indexnow_key(site_name):
    try:
        with open("/root/.hermes/config/sites.json") as f:
            data = json.load(f)
        info = next((s for s in data.get("sites", []) if s.get("name") == site_name), None)
        if not info: return None
        if info.get("indexnow_key"): return info["indexnow_key"]
        account = info.get("account", "")
        return data.get("accounts", {}).get(account, {}).get("indexnow_key")
    except:
        return None

def submit_indexnow(urls, site_name):
    key = get_indexnow_key(site_name)
    domain = get_site_domain(site_name)
    if not key or not domain:
        return 0, len(urls)
    host = f"https://{domain}"
    total_ok = total_fail = 0
    for i in range(0, len(urls), 10000):
        batch = urls[i:i+10000]
        payload = json.dumps({"host": host, "key": key, "keyLocation": f"{host}/{key}.txt", "urlList": batch}).encode()
        try:
            req = urllib.request.Request("https://api.indexnow.org/indexnow", data=payload,
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as resp:
                if resp.getcode() in (200, 202): total_ok += len(batch)
                else: total_fail += len(batch)
        except:
            total_fail += len(batch)
        if i + 10000 < len(urls): time.sleep(1.5)
    return total_ok, total_fail

def process_one(idx, total, type_name, slug):
    topic = slug.replace('-', ' ').title()
    author = random.choice(AUTHORS)
    s = stats["success"] + stats["failed"]
    print(f"[{s+1}/{total}] {type_name}/{slug}", flush=True)
    try:
        article_data = retry(lambda: generate_article(type_name, slug), max_attempts=2, label="article")
        body = article_data.get("article", "")
        title = article_data.get("title", topic)
        description = article_data.get("description", f"Learn about {topic}")
        text_len = len(re.sub(r'<[^>]+>', '', body))
        if text_len < 1500:
            print(f"  Too short ({text_len})", flush=True)
            with stats_lock: stats["failed"] += 1
            return False
        body = re.sub(r'<img[^>]*>', '', body)
        body = re.sub(r'<style[\s\S]*?</style>', '', body, flags=re.IGNORECASE)
        body = re.sub(r'<script[\s\S]*?</script>', '', body, flags=re.IGNORECASE)
    except Exception as e:
        print(f"  FAIL article: {str(e)[:80]}", flush=True)
        with stats_lock: stats["failed"] += 1
        return False
    now = datetime.now()
    pub = now - timedelta(days=random.randint(0, 14))
    mod = pub + timedelta(days=random.randint(1, 30))
    try:
        ok = insert_article({
            'site': SITE, 'type': type_name, 'short_title': slug, 'language': 'en',
            'published_time': pub, 'modified_time': mod, 'author': author,
            'img': '', 'title': title, 'description': description,
            'url': f"/{type_name}/{slug}", 'body': body, 'tag': type_name,
            'is_online': 'Y', 'slug': slug})
        if ok:
            print(f"  OK — {title[:50]}", flush=True)
            with stats_lock: stats["success"] += 1
            domain = get_site_domain(SITE)
            if domain:
                with urls_lock: successful_urls.append(f"https://{domain}/{type_name}/{slug}")
            return True
        else:
            with stats_lock: stats["failed"] += 1
            return False
    except Exception as e:
        print(f"  FAIL db: {str(e)[:80]}", flush=True)
        with stats_lock: stats["failed"] += 1
        return False

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    raw_file = DATA_DIR / "raw_slugs.txt"
    if not raw_file.exists():
        print(f"No slugs file: {raw_file}"); sys.exit(1)
    with open(raw_file) as f:
        all_slugs = [l.strip() for l in f if l.strip()]
    print(f"Slugs: {len(all_slugs)}", flush=True)
    if not all_slugs:
        print("No slugs"); sys.exit(1)
    # 2026-09-11 fix: exclude consumed slugs BEFORE selection — random picks from
    # the full pool almost never hit fresh slugs on exhausted sites (To process: 0)
    ckpt_file = OUTPUT_DIR / "checkpoint.json"
    completed = load_checkpoint(ckpt_file)
    _used_file = DATA_DIR / "used_slugs.json"
    _used = set()
    if _used_file.exists():
        try:
            with open(_used_file) as f: _used = set(json.load(f))
        except Exception: pass
    avail_slugs = [s for s in all_slugs if s not in completed and s not in _used]
    print(f"Available: {len(avail_slugs)} / {len(all_slugs)}", flush=True)
    if not avail_slugs:
        print("No available slugs (all consumed) — run slug collector", flush=True)
        return
    classified = [(classify_slug(s), s) for s in avail_slugs]
    for t in TYPES:
        print(f"  {t}: {sum(1 for c,_ in classified if c==t)}", flush=True)
    per_type = TARGET // len(TYPES)
    remainder = TARGET - per_type * len(TYPES)
    selected = []
    for i, t in enumerate(TYPES):
        pool = [s for c, s in classified if c == t]
        random.shuffle(pool)
        take = min(per_type + (1 if i < remainder else 0), len(pool))
        selected.extend([(t, s) for s in pool[:take]])
    random.shuffle(selected)
    tasks = [(i, len(selected), t, s) for i, (t, s) in enumerate(selected)]
    print(f"Target: {len(selected)} | Done: {len(completed)} | To process: {len(tasks)}", flush=True)
    if not tasks:
        print("All done"); return
    start = time.time()
    done_count = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(process_one, *t): t[3] for t in tasks}
        for f in as_completed(futures):
            slug = futures[f]
            if f.result():
                completed.add(slug)
                done_count += 1
                if done_count % 10 == 0:
                    save_checkpoint(ckpt_file, completed)
    save_checkpoint(ckpt_file, completed)
    used_file = DATA_DIR / "used_slugs.json"
    used = set()
    if used_file.exists():
        with open(used_file) as f: used = set(json.load(f))
    used.update(completed)
    with open(used_file, "w") as f:
        json.dump(sorted(used), f)
    if successful_urls:
        print(f"IndexNow: {len(successful_urls)} URLs", flush=True)
        submit_indexnow(successful_urls, SITE)
    elapsed = time.time() - start
    print(f"\nDone! Success: {stats['success']} Failed: {stats['failed']} Time: {elapsed/60:.1f}min", flush=True)

if __name__ == "__main__":
    main()
