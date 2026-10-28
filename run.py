"""Start the ShortsForge server and open it in the browser (used by the start scripts).

Pass --phone to also allow phones and tablets on the same Wi-Fi to open the app.
"""
import socket
import sys
import threading
import urllib.request
import webbrowser
from pathlib import Path

HOST, PORT = "127.0.0.1", 8000
URL = f"http://localhost:{PORT}"
ROOT = Path(__file__).resolve().parent


def already_running() -> bool:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{PORT}/api/health", timeout=2) as r:
            return b'"ok"' in r.read()
    except Exception:
        return False


def port_busy() -> bool:
    with socket.socket() as s:
        return s.connect_ex((HOST, PORT)) == 0


def lan_ip() -> str | None:
    """This computer's address on the local network (no data is sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


def main() -> None:
    phone = "--phone" in sys.argv[1:]
    if already_running():
        print(f"ShortsForge is already running. Opening {URL}")
        webbrowser.open(URL)
        return
    if port_busy():
        print(f"Port {PORT} is used by another program. Close it and try again.")
        sys.exit(1)

    sys.path.insert(0, str(ROOT / "backend"))
    import uvicorn

    threading.Timer(1.5, lambda: webbrowser.open(URL)).start()
    print(f"\n  ShortsForge is running at {URL}\n  Keep this window open while you use it. Close it to stop.\n", flush=True)
    if phone:
        ip = lan_ip()
        where = f"http://{ip}:{PORT}" if ip else f"this computer's network address, port {PORT}"
        print(f"  Phone mode: on a phone or tablet on the same Wi-Fi, open {where}\n"
              "  Anyone on this Wi-Fi can use the app while it runs, so only do this on a network you trust.\n", flush=True)
    uvicorn.run("app.main:app", host="0.0.0.0" if phone else HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
