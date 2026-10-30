#!/usr/bin/env python3
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
TOKEN = os.environ.get("RELAY_TOKEN", "")
ANNOUNCE_URLS = [
    u.strip()
    for u in os.environ.get(
        "ANNOUNCE_URLS",
        "https://the-fplace.vercel.app/api/player/relay,https://the-hustle-place.vercel.app/api/player/relay",
    ).split(",")
    if u.strip()
]
CONTAINER = os.environ.get("TUNNEL_CONTAINER", "hustle-vixsrc-tunnel")
HEARTBEAT_INTERVAL = 60
LAST_ANNOUNCED_AT = 0.0


def announce(url: str) -> bool:
    global LAST_ANNOUNCED_AT
    success = False
    for target in ANNOUNCE_URLS:
        request = urllib.request.Request(
            target,
            data=json.dumps({"url": url}).encode(),
            headers={"Content-Type": "application/json", "x-relay-token": TOKEN},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                print(f"announced {url} -> {target} : {response.status}", flush=True)
                success = True
        except Exception as error:
            print(f"announce fail -> {target} : {error}", flush=True)
    if success:
        LAST_ANNOUNCED_AT = time.time()
    return success


def scan(text: str, last: str | None) -> str | None:
    match = URL_RE.search(text)
    if not match:
        return last
    url = match.group(0)
    now = time.time()
    if url != last or (now - LAST_ANNOUNCED_AT > HEARTBEAT_INTERVAL):
        if announce(url):
            return url
    return last if last else url


def logs(follow: bool, since: str | None = None) -> subprocess.Popen:
    command = ["docker", "logs", CONTAINER]
    if follow:
        command.append("-f")
    if since:
        command.extend(["--since", since])
    return subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def main() -> None:
    if not TOKEN:
        raise SystemExit("RELAY_TOKEN mancante")
    last = None
    bootstrap = logs(False)
    out, _ = bootstrap.communicate(timeout=20)
    last = scan(out, last)
    while True:
        try:
            proc = logs(True, "2m")
            assert proc.stdout
            for line in proc.stdout:
                last = scan(line, last)
                if last and (time.time() - LAST_ANNOUNCED_AT > HEARTBEAT_INTERVAL):
                    announce(last)
        except Exception as error:
            print("watch error", error, flush=True)
        if last and (time.time() - LAST_ANNOUNCED_AT > HEARTBEAT_INTERVAL):
            announce(last)
        time.sleep(4)


if __name__ == "__main__":
    main()
