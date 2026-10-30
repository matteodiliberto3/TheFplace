#!/usr/bin/env python3
import json
import os
import re
import ssl
import time
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore, Lock
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, parse_qsl, quote, urljoin, urlparse, urlencode, urlunparse
from urllib.request import Request, urlopen

ALLOWED_HOST = re.compile(r"^(?:[a-z0-9-]+\.)*(?:vixsrc\.to|vix-content\.net)$", re.I)
# Keep in sync with lib/vixsrc-cdn-allowlist.ts
EDGE_CDN_HOST = re.compile(r"^sc-[a-z0-9]+-\d+\.[a-z0-9.-]+$", re.I)
ALLOWED_ORIGINS = {
    "https://the-fplace.vercel.app",
    "https://the-hustle-place.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}
TOKEN = os.environ.get("RELAY_TOKEN", "")
PORT = int(os.environ.get("PORT", "8787"))
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
PART_PREFIX = "__PART__"
SSL_CTX = ssl.create_default_context()
RESOLVE_LIMIT = max(1, int(os.environ.get("RESOLVE_LIMIT", "6")))
CACHE_TTL = max(1, int(os.environ.get("RESOLVE_CACHE_TTL", "300")))
RESOLVE_WAIT = max(0.0, float(os.environ.get("RESOLVE_WAIT", "1")))
RESOLVE_SEM = BoundedSemaphore(RESOLVE_LIMIT)
CACHE_LOCK = Lock()
INFLIGHT_LOCK = Lock()
CACHE: dict[tuple, tuple[float, dict]] = {}
INFLIGHT = 0


def host_allowed(raw: str) -> bool:
    try:
        parsed = urlparse(raw)
        host = parsed.hostname
        return parsed.scheme == "https" and bool(host) and bool(
            ALLOWED_HOST.match(host) or EDGE_CDN_HOST.match(host)
        )
    except ValueError:
        return False


def vixsrc_get(url: str) -> tuple[int, bytes, str]:
    request = Request(
        url,
        headers={
            "User-Agent": BROWSER_UA,
            "Referer": "https://vixsrc.to/",
            "Accept": "*/*",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        },
    )
    try:
        with urlopen(request, timeout=25, context=SSL_CTX) as response:
            return response.status, response.read(), response.headers.get("Content-Type") or "application/octet-stream"
    except HTTPError as error:
        return error.code, error.read(), (error.headers.get("Content-Type") if error.headers else "text/plain") or "text/plain"


def parse_src(body: str) -> str | None:
    match = re.search(r'\{"src":"([^"]+)"', body)
    if match:
        return match.group(1).replace("\\/", "/").replace("&amp;", "&")
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    src = data.get("src")
    return src.replace("&amp;", "&") if isinstance(src, str) and src.startswith("/") else None


def parse_embed(html: str) -> dict | None:
    token = re.search(r"['\"]token['\"]\s*:\s*['\"]([^'\"]+)['\"]", html)
    expires = re.search(r"['\"]expires['\"]\s*:\s*['\"]([^'\"]+)['\"]", html)
    url = re.search(r"masterPlaylist[\s\S]*?url:\s*['\"]([^'\"]+)['\"]", html) or re.search(
        r"url:\s*['\"](https?://[^'\"]*playlist[^'\"]*)['\"]", html
    )
    if not (token and expires and url):
        return None
    video = re.search(r"window\.video\s*=\s*\{[\s\S]*?id:\s*['\"](\d+)['\"]", html)
    return {
        "token": token.group(1),
        "expires": expires.group(1),
        "url": url.group(1),
        "videoId": int(video.group(1)) if video else None,
    }


def playlist_url(parsed: dict, lang: str) -> str:
    target = urlparse(parsed["url"])
    query = dict(parse_qsl(target.query, keep_blank_values=True))
    query.update({"token": parsed["token"], "expires": parsed["expires"], "h": "1", "lang": lang})
    return urlunparse(target._replace(query=urlencode(query)))


def classify(absolute: str) -> str:
    if not host_allowed(absolute):
        return "drop"
    parsed = urlparse(absolute)
    host = parsed.hostname or ""
    if host.endswith("vix-content.net") or EDGE_CDN_HOST.match(host):
        return "cdn"
    if "/storage/" in parsed.path or parsed.path.endswith(".key"):
        return "key"
    return "playlist"


def stream_looks_playable(parts: dict[str, str]) -> bool:
    for text in parts.values():
        if len(re.findall(r"#EXTINF", text)) < 8:
            continue
        if "https://" in text:
            return True
    return False


def rewrite(body: str, source: str, resolve_ref) -> str:
    lines = []
    for line in body.splitlines():
        trimmed = line.strip()
        if not trimmed:
            lines.append(line)
            continue
        if trimmed.startswith("#"):

            def replace(match: re.Match[str]) -> str:
                absolute = urljoin(source, match.group(1))
                kind = classify(absolute)
                if kind == "drop":
                    return 'URI=""'
                return f'URI="{resolve_ref(absolute, kind)}"'

            lines.append(re.sub(r'URI="([^"]+)"', replace, line, flags=re.I))
            continue
        absolute = urljoin(source, trimmed)
        if not host_allowed(absolute):
            lines.append("")
            continue
        kind = classify(absolute)
        lines.append("" if kind == "drop" else resolve_ref(absolute, kind))
    return "\n".join(lines)


def normalize_cdn(raw: str) -> str:
    try:
        parsed = urlparse(raw)
        host = parsed.hostname or ""
        if EDGE_CDN_HOST.match(host) or host.endswith("vix-content.net"):
            new_path = re.sub(r"\.(html|m4s)$", ".ts", parsed.path, flags=re.I)
            return urlunparse(parsed._replace(path=new_path))
        return raw
    except Exception:
        return raw


def assemble(master_url: str, video_id: int | None) -> dict:
    part_ids: dict[str, str] = {}
    pending = [master_url]
    fetched: dict[str, str] = {}
    key_uri = None

    def part_id_for(url: str) -> str:
        current = part_ids.get(url)
        if current:
            return current
        ident = f"p{len(part_ids)}"
        part_ids[url] = ident
        pending.append(url)
        return ident

    def resolve_ref(absolute: str, kind: str) -> str:
        if kind == "cdn":
            return normalize_cdn(absolute)
        if kind == "key":
            return key_uri or absolute
        return f"{PART_PREFIX}{part_id_for(absolute)}.m3u8"

    while pending:
        url = pending.pop(0)
        if url in fetched:
            continue
        status, raw, _ = vixsrc_get(url)
        body = raw.decode("utf-8", "replace")
        if status != 200 or ("#EXTM3U" not in body and "#EXT-X" not in body):
            raise RuntimeError(f"manifest {status}")
        nonlocal_key = key_uri
        if key_uri is None:
            for match in re.finditer(r'URI="([^"]+)"', body, flags=re.I):
                absolute = urljoin(url, match.group(1))
                if classify(absolute) == "key":
                    key_status, key_body, _ = vixsrc_get(absolute)
                    if key_status != 200:
                        raise RuntimeError(f"key {key_status}")
                    key_uri = "data:application/octet-stream;base64," + b64encode(key_body).decode("ascii")
                    break
        fetched[url] = rewrite(body, url, resolve_ref)

    master = fetched.get(master_url)
    if not master:
        raise RuntimeError("master vuoto")
    parts = {ident: fetched[url] for url, ident in part_ids.items() if url in fetched}
    if not stream_looks_playable(parts):
        raise RuntimeError("playlist senza segmenti")
    return {"master": master, "parts": parts, "videoId": video_id}


def resolve_title(
    tmdb_id: int, kind: str, season: int | None, episode: int | None, lang: str, fresh: bool = False
) -> dict:
    cache_key = (tmdb_id, kind, season, episode, lang)
    now = time.time()
    if not fresh:
        with CACHE_LOCK:
            hit = CACHE.get(cache_key)
            if hit and hit[0] > now:
                return hit[1]
    if not RESOLVE_SEM.acquire(timeout=RESOLVE_WAIT):
        raise RuntimeError("relay occupato")
    global INFLIGHT
    try:
        if not fresh:
            with CACHE_LOCK:
                hit = CACHE.get(cache_key)
                if hit and hit[0] > time.time():
                    return hit[1]
        with INFLIGHT_LOCK:
            INFLIGHT += 1
        try:
            data = fetch_title(tmdb_id, kind, season, episode, lang)
        finally:
            with INFLIGHT_LOCK:
                INFLIGHT -= 1
        with CACHE_LOCK:
            CACHE[cache_key] = (time.time() + CACHE_TTL, data)
        return data
    finally:
        RESOLVE_SEM.release()


def fetch_title(tmdb_id: int, kind: str, season: int | None, episode: int | None, lang: str) -> dict:
    api = (
        f"https://vixsrc.to/api/movie/{tmdb_id}?lang={quote(lang)}"
        if kind == "movie"
        else f"https://vixsrc.to/api/tv/{tmdb_id}/{season}/{episode}?lang={quote(lang)}"
    )
    status, raw, _ = vixsrc_get(api)
    if status != 200:
        raise RuntimeError(f"api {status}")
    src = parse_src(raw.decode("utf-8", "replace"))
    if not src:
        raise RuntimeError("api senza embed")
    embed_url = urljoin("https://vixsrc.to", src)
    if not host_allowed(embed_url):
        raise RuntimeError("embed non consentito")
    status, raw, _ = vixsrc_get(embed_url)
    if status != 200:
        raise RuntimeError(f"embed {status}")
    parsed = parse_embed(raw.decode("utf-8", "replace"))
    if not parsed:
        raise RuntimeError("playlist non trovata")
    target = playlist_url(parsed, lang)
    if not host_allowed(target):
        raise RuntimeError("playlist non consentita")
    return assemble(target, parsed.get("videoId"))


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            with INFLIGHT_LOCK:
                inflight = INFLIGHT
            with CACHE_LOCK:
                cached = len(CACHE)
            payload = json.dumps(
                {"ok": True, "inflight": inflight, "cache": cached, "limit": RESOLVE_LIMIT}
            ).encode()
            self._send(200, payload, "application/json")
            return
        if parsed.path == "/resolve":
            qs = parse_qs(parsed.query)
            if not self._allowed_resolve(qs):
                self._send(401, b'{"success":false,"error":"unauthorized"}', "application/json")
                return
            try:
                tmdb_id = int((qs.get("tmdbId") or [""])[0])
                kind = "tv" if (qs.get("type") or ["movie"])[0] == "tv" else "movie"
                season = int((qs.get("season") or ["0"])[0] or 0) or None
                episode = int((qs.get("episode") or ["0"])[0] or 0) or None
                if tmdb_id <= 0 or (kind == "tv" and (not season or not episode)):
                    raise ValueError("parametri")
                fresh = (qs.get("fresh") or [""])[0] == "1"
                data = resolve_title(tmdb_id, kind, season, episode, "it", fresh)
                self._send(200, json.dumps({"success": True, "data": data}).encode(), "application/json")
            except Exception as error:
                message = str(error)
                if "404" in message or "non trovata" in message or "non trovato" in message:
                    status = 404
                elif "occupato" in message:
                    status = 503
                else:
                    status = 502
                self._send(status, json.dumps({"success": False, "error": message}).encode(), "application/json")
            return
        if parsed.path != "/fetch":
            self._send(404, b"not found", "text/plain")
            return
        if not TOKEN or self.headers.get("x-relay-token") != TOKEN:
            self._send(401, b"unauthorized", "text/plain")
            return
        raw = (parse_qs(parsed.query).get("u") or [""])[0]
        if not host_allowed(raw):
            self._send(400, b"host not allowed", "text/plain")
            return
        status, body, content_type = vixsrc_get(raw)
        self._send(status, body, content_type)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} {format % args}", flush=True)

    def _allowed_resolve(self, qs: dict | None = None) -> bool:
        if TOKEN:
            if self.headers.get("x-relay-token") == TOKEN:
                return True
            if qs and (qs.get("token") or [""])[0] == TOKEN:
                return True
        origin = self.headers.get("Origin") or ""
        referer = self.headers.get("Referer") or ""
        if origin in ALLOWED_ORIGINS:
            return True
        return any(referer.startswith(item + "/") or referer == item for item in ALLOWED_ORIGINS)

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "content-type, x-relay-token")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        elif origin:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type, x-relay-token")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("RELAY_TOKEN mancante")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"vixsrc-relay on {PORT}", flush=True)
    server.serve_forever()
