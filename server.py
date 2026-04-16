from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from http import HTTPStatus
from http.cookies import Morsel, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
_db_env = os.getenv("CT_DB_PATH", "")
DB_PATH = Path(_db_env).resolve() if _db_env else BASE_DIR / "clean_time.db"
SESSION_COOKIE = "ct_session"
SESSION_TTL_HOURS = 12
MAX_BODY_SIZE = 64 * 1024
SECURE_COOKIE = os.getenv("CT_SECURE_COOKIE", "0") == "1"
MAX_SESSIONS_PER_USER = 5

LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_ATTEMPTS_IP = 10
LOGIN_MAX_ATTEMPTS_USER = 5
USERNAME_LOCKOUT_WINDOW_SECONDS = 30 * 60

# ── Security audit logger ──────────────────────────────────────────────────
_sec_logger = logging.getLogger("cleantime.security")
_sec_handler = logging.StreamHandler(sys.stderr)
_sec_handler.setFormatter(logging.Formatter("%(asctime)s SECURITY %(levelname)s %(message)s"))
_sec_logger.addHandler(_sec_handler)
_sec_logger.setLevel(logging.INFO)
_sec_logger.propagate = False


def sec_log(event: str, **kwargs: Any) -> None:
    parts = " ".join(f"{k}={v!r}" for k, v in kwargs.items())
    _sec_logger.info("event=%s %s", event, parts)

CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
}

SERVICES = {
    "خداديات": {
        "unit": "قطعة",
        "price": 10.0,
        "priceOptions": [
            {"label": "5 ريال", "price": 5.0},
            {"label": "10 ريال", "price": 10.0},
        ],
    },
    "موكيت": {"unit": "متر", "price": 7.0},
    "كنب": {"unit": "متر", "price": 20.0},
    "جلسة عربي": {"unit": "متر", "price": 10.0},
    "مكيف دولابي": {"unit": "قطعة", "price": 90.0},
    "مكيف شباك": {"unit": "قطعة", "price": 35.0},
    "مكيف أسبليت": {"unit": "قطعة", "price": 50.0},
    "ستائر": {
        "unit": "قطعة",
        "price": 10.0,
        "priceOptions": [
            {"label": "10 ريال", "price": 10.0},
            {"label": "15 ريال", "price": 15.0},
        ],
    },
    "فله": {"unit": "خدمة", "price": 0.0, "agreedPrice": True, "quantityLocked": True},
    "مسابح": {"unit": "خدمة", "price": 0.0, "agreedPrice": True, "quantityLocked": True},
    "أرضيات": {"unit": "متر", "price": 4.0},
    "نوافذ": {
        "unit": "قطعة",
        "price": 10.0,
        "priceOptions": [
            {"label": "10 ريال", "price": 10.0},
            {"label": "15 ريال", "price": 15.0},
        ],
    },
    "خدمات مساجد": {"unit": "خدمة", "price": 0.0, "agreedPrice": True, "quantityLocked": True},
    "شقة": {"unit": "خدمة", "price": 0.0, "agreedPrice": True, "quantityLocked": True},
    "نظافة عامه": {"unit": "خدمة", "price": 0.0, "agreedPrice": True, "quantityLocked": True},
}

TEAM_NAMES = {
    "team1": "الفريق الأول",
    "team2": "الفريق الثاني",
    "team3": "الفريق الثالث",
    "team4": "الفريق الرابع",
    "team5": "الفريق الخامس",
}

PAYMENT_METHODS = {"كاش", "شبكة", "تحويل", "مختلط"}
ROLES = {"admin", "team"}


def now_local() -> datetime:
    return datetime.now().astimezone()


def iso_now() -> str:
    return now_local().isoformat(timespec="seconds")


def set_cookie_headers(cookie: SimpleCookie) -> list[tuple[str, str]]:
    return [("Set-Cookie", morsel.OutputString()) for morsel in cookie.values()]


def build_session_cookie(value: str, max_age: int) -> SimpleCookie:
    cookie = SimpleCookie()
    cookie[SESSION_COOKIE] = value
    morsel: Morsel = cookie[SESSION_COOKIE]
    morsel["path"] = "/"
    morsel["httponly"] = True
    morsel["samesite"] = "Strict"
    morsel["max-age"] = str(max_age)
    if SECURE_COOKIE:
        morsel["secure"] = True
    return cookie


def parse_cookies(header_value: str | None) -> SimpleCookie:
    cookie = SimpleCookie()
    if header_value:
        cookie.load(header_value)
    return cookie


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'team')),
                display_name TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                csrf_token TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_number TEXT UNIQUE,
                team_username TEXT NOT NULL,
                team_name TEXT NOT NULL,
                service_type TEXT NOT NULL,
                unit TEXT NOT NULL,
                quantity REAL NOT NULL,
                unit_price REAL NOT NULL,
                discount REAL NOT NULL DEFAULT 0,
                total_price REAL NOT NULL,
                customer_phone TEXT NOT NULL,
                payment_method TEXT NOT NULL,
                cash_amount REAL NOT NULL DEFAULT 0,
                network_amount REAL NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                admin_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                service_type TEXT NOT NULL,
                unit TEXT NOT NULL,
                quantity REAL NOT NULL,
                unit_price REAL NOT NULL,
                discount REAL NOT NULL DEFAULT 0,
                total_price REAL NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
            CREATE INDEX IF NOT EXISTS idx_order_items_service_type ON order_items(service_type);

            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_address TEXT NOT NULL,
                username TEXT NOT NULL DEFAULT '',
                attempted_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, attempted_at);
            CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username, attempted_at);

            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                amount REAL NOT NULL,
                created_by_username TEXT NOT NULL,
                created_by_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                amount REAL NOT NULL,
                team_username TEXT NOT NULL,
                team_name TEXT NOT NULL,
                created_by_username TEXT NOT NULL,
                created_by_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    if not password or len(password) < 4:
        raise ValueError("Password must be at least 4 characters long.")
    salt = salt or os.urandom(16)
    iterations = 600_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(
        iterations,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt_b64, digest_b64 = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        candidate = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            int(iterations),
        )
        return hmac.compare_digest(candidate, expected)
    except Exception:
        return False


def sanitize_username(username: str) -> str:
    value = username.strip().lower()
    if not value:
        raise ValueError("اسم المستخدم مطلوب.")
    if len(value) > 40:
        raise ValueError("اسم المستخدم طويل جدًا.")
    allowed = set("abcdefghijklmnopqrstuvwxyz0123456789._-")
    if any(ch not in allowed for ch in value):
        raise ValueError("اسم المستخدم يحتوي على رموز غير مسموحة.")
    return value


def normalize_phone(phone: str) -> str:
    cleaned = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if cleaned.startswith("+966"):
        cleaned = "0" + cleaned[4:]
    if cleaned.startswith("00966"):
        cleaned = "0" + cleaned[5:]
    if cleaned.startswith("966"):
        cleaned = "0" + cleaned[3:]
    if cleaned.startswith("5") and len(cleaned) == 9:
        cleaned = "0" + cleaned
    if len(cleaned) == 10 and cleaned.startswith("05"):
        return cleaned
    raise ValueError("رقم الجوال غير صحيح.")


def validate_text(value: str, *, field_name: str, max_length: int = 1000) -> str:
    text = value.strip()
    if len(text) > max_length:
        raise ValueError(f"{field_name} طويل جدًا.")
    return text


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return handler.client_address[0]


def _purge_old_attempts(conn: sqlite3.Connection) -> None:
    cutoff = (datetime.now() - timedelta(seconds=max(LOGIN_WINDOW_SECONDS, USERNAME_LOCKOUT_WINDOW_SECONDS))).isoformat()
    conn.execute("DELETE FROM login_attempts WHERE attempted_at < ?", (cutoff,))


def record_login_attempt(handler: BaseHTTPRequestHandler, username: str = "") -> None:
    ip = client_ip(handler)
    ts = datetime.now().isoformat()
    with get_db() as conn:
        _purge_old_attempts(conn)
        conn.execute(
            "INSERT INTO login_attempts (ip_address, username, attempted_at) VALUES (?, ?, ?)",
            (ip, username.lower(), ts),
        )
    sec_log("login_failed", ip=ip, username=username)


def clear_login_attempts(handler: BaseHTTPRequestHandler, username: str = "") -> None:
    ip = client_ip(handler)
    with get_db() as conn:
        conn.execute("DELETE FROM login_attempts WHERE ip_address = ?", (ip,))
        if username:
            conn.execute("DELETE FROM login_attempts WHERE username = ?", (username.lower(),))


def too_many_attempts(handler: BaseHTTPRequestHandler, username: str = "") -> tuple[bool, int]:
    """Return (blocked, retry_after_seconds). Checks both IP and username."""
    ip = client_ip(handler)
    now = datetime.now()
    ip_cutoff = (now - timedelta(seconds=LOGIN_WINDOW_SECONDS)).isoformat()
    user_cutoff = (now - timedelta(seconds=USERNAME_LOCKOUT_WINDOW_SECONDS)).isoformat()
    with get_db() as conn:
        _purge_old_attempts(conn)
        ip_count = conn.execute(
            "SELECT COUNT(*) FROM login_attempts WHERE ip_address = ? AND attempted_at >= ?",
            (ip, ip_cutoff),
        ).fetchone()[0]
        if ip_count >= LOGIN_MAX_ATTEMPTS_IP:
            oldest = conn.execute(
                "SELECT MIN(attempted_at) FROM login_attempts WHERE ip_address = ? AND attempted_at >= ?",
                (ip, ip_cutoff),
            ).fetchone()[0]
            retry_after = LOGIN_WINDOW_SECONDS - int((now - datetime.fromisoformat(oldest)).total_seconds())
            return True, max(retry_after, 60)
        if username:
            user_count = conn.execute(
                "SELECT COUNT(*) FROM login_attempts WHERE username = ? AND attempted_at >= ?",
                (username.lower(), user_cutoff),
            ).fetchone()[0]
            if user_count >= LOGIN_MAX_ATTEMPTS_USER:
                oldest = conn.execute(
                    "SELECT MIN(attempted_at) FROM login_attempts WHERE username = ? AND attempted_at >= ?",
                    (username.lower(), user_cutoff),
                ).fetchone()[0]
                retry_after = USERNAME_LOCKOUT_WINDOW_SECONDS - int((now - datetime.fromisoformat(oldest)).total_seconds())
                return True, max(retry_after, 60)
    return False, 0


def create_user(
    username: str,
    password: str,
    role: str,
    display_name: str,
) -> None:
    username = sanitize_username(username)
    if role not in ROLES:
        raise ValueError("الدور غير صالح.")
    display_name = validate_text(display_name, field_name="اسم العرض", max_length=80)
    password_hash = hash_password(password)
    ts = iso_now()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO users (username, password_hash, role, display_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (username, password_hash, role, display_name, ts, ts),
        )


def reset_password(username: str, password: str) -> None:
    username = sanitize_username(username)
    with get_db() as conn:
        cur = conn.execute("SELECT id FROM users WHERE username = ?", (username,))
        if cur.fetchone() is None:
            raise ValueError("المستخدم غير موجود.")
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?",
            (hash_password(password), iso_now(), username),
        )


def get_team_names(*, include_inactive: bool = False) -> dict[str, str]:
    sql = "SELECT username, display_name FROM users WHERE role = 'team'"
    if not include_inactive:
        sql += " AND is_active = 1"
    sql += " ORDER BY display_name, username"
    with get_db() as conn:
        rows = conn.execute(sql).fetchall()
    return {row["username"]: row["display_name"] for row in rows}


def purge_expired_sessions(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (iso_now(),))


def get_user_by_session(handler: BaseHTTPRequestHandler) -> dict[str, Any] | None:
    cookie = parse_cookies(handler.headers.get("Cookie"))
    morsel = cookie.get(SESSION_COOKIE)
    if not morsel:
        return None
    session_id = morsel.value
    with get_db() as conn:
        purge_expired_sessions(conn)
        row = conn.execute(
            """
            SELECT s.id AS session_id, s.csrf_token, s.expires_at,
                   u.id AS user_id, u.username, u.role, u.display_name, u.is_active
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ?
            """,
            (session_id,),
        ).fetchone()
        if row is None or not row["is_active"]:
            return None
        expires_at = datetime.fromisoformat(row["expires_at"])
        if expires_at <= now_local():
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            return None
        return {
            "session_id": row["session_id"],
            "csrf_token": row["csrf_token"],
            "id": row["user_id"],
            "username": row["username"],
            "role": row["role"],
            "name": row["display_name"],
        }


def create_session(user_id: int) -> tuple[str, str]:
    session_id = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(24)
    expires_at = (now_local() + timedelta(hours=SESSION_TTL_HOURS)).isoformat(timespec="seconds")
    with get_db() as conn:
        # Enforce concurrent session cap — keep newest (MAX_SESSIONS_PER_USER - 1), delete oldest
        old_ids = conn.execute(
            """
            SELECT id FROM sessions WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT -1 OFFSET ?
            """,
            (user_id, MAX_SESSIONS_PER_USER - 1),
        ).fetchall()
        if old_ids:
            placeholders = ",".join("?" for _ in old_ids)
            conn.execute(
                f"DELETE FROM sessions WHERE id IN ({placeholders})",
                [row["id"] for row in old_ids],
            )
        conn.execute(
            """
            INSERT INTO sessions (id, user_id, csrf_token, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, user_id, csrf_token, expires_at, iso_now()),
        )
    return session_id, csrf_token


def destroy_session(session_id: str | None) -> None:
    if not session_id:
        return
    with get_db() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))


def require_auth(handler: "AppHandler", role: str | None = None) -> dict[str, Any] | None:
    user = get_user_by_session(handler)
    if user is None:
        handler.send_json({"error": "unauthorized", "message": "تحتاج إلى تسجيل الدخول."}, status=HTTPStatus.UNAUTHORIZED)
        return None
    if role and user["role"] != role:
        handler.send_json({"error": "forbidden", "message": "ليس لديك صلاحية للوصول."}, status=HTTPStatus.FORBIDDEN)
        return None
    return user


def require_csrf(handler: "AppHandler", user: dict[str, Any]) -> bool:
    token = handler.headers.get("X-CSRF-Token", "")
    if not token or not hmac.compare_digest(token, user["csrf_token"]):
        handler.send_json(
            {"error": "csrf_failed", "message": "تعذر التحقق من أمان الطلب."},
            status=HTTPStatus.FORBIDDEN,
        )
        return False
    return True


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    ct = handler.headers.get("Content-Type", "")
    if ct and "application/json" not in ct.lower():
        raise ValueError("Content-Type يجب أن يكون application/json.")
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as exc:
        raise ValueError("حجم الطلب غير صالح.") from exc
    if length <= 0:
        return {}
    if length > MAX_BODY_SIZE:
        raise ValueError("الطلب كبير جدًا.")
    raw = handler.rfile.read(length)
    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("تعذر قراءة بيانات الطلب.") from exc
    if not isinstance(payload, dict):
        raise ValueError("بيانات الطلب غير صالحة.")
    return payload


def get_order_for_user(order_id: int, user: dict[str, Any]) -> sqlite3.Row | None:
    sql = "SELECT * FROM orders WHERE id = ?"
    params: list[Any] = [order_id]
    if user["role"] == "team":
        sql += " AND team_username = ?"
        params.append(user["username"])
    with get_db() as conn:
        return conn.execute(sql, params).fetchone()


def format_number(value: float) -> str:
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return f"{number:g}"


def build_order_item_payload(
    *,
    service_type: str,
    unit: str,
    quantity: float,
    unit_price: float,
    discount: float,
    total_price: float,
    item_id: int | None = None,
    sort_order: int = 0,
) -> dict[str, Any]:
    return {
        "id": item_id,
        "serviceType": service_type,
        "unit": unit,
        "quantity": round(float(quantity), 2),
        "unitPrice": round(float(unit_price), 2),
        "discount": round(float(discount), 2),
        "totalPrice": round(float(total_price), 2),
        "sortOrder": sort_order,
    }


def fallback_order_item_payload(row: sqlite3.Row) -> dict[str, Any]:
    return build_order_item_payload(
        service_type=row["service_type"],
        unit=row["unit"],
        quantity=row["quantity"],
        unit_price=row["unit_price"],
        discount=row["discount"],
        total_price=row["total_price"],
    )


def fetch_order_items_map(order_rows: list[sqlite3.Row]) -> dict[int, list[dict[str, Any]]]:
    if not order_rows:
        return {}

    order_ids = [int(row["id"]) for row in order_rows]
    placeholders = ",".join("?" for _ in order_ids)
    items_map: dict[int, list[dict[str, Any]]] = {order_id: [] for order_id in order_ids}

    with get_db() as conn:
        item_rows = conn.execute(
            f"""
            SELECT id, order_id, service_type, unit, quantity, unit_price, discount, total_price, sort_order
            FROM order_items
            WHERE order_id IN ({placeholders})
            ORDER BY order_id, sort_order, id
            """,
            order_ids,
        ).fetchall()

    for item_row in item_rows:
        items_map[item_row["order_id"]].append(
            build_order_item_payload(
                item_id=item_row["id"],
                service_type=item_row["service_type"],
                unit=item_row["unit"],
                quantity=item_row["quantity"],
                unit_price=item_row["unit_price"],
                discount=item_row["discount"],
                total_price=item_row["total_price"],
                sort_order=item_row["sort_order"],
            )
        )

    for row in order_rows:
        if not items_map[int(row["id"])]:
            items_map[int(row["id"])] = [fallback_order_item_payload(row)]

    return items_map


def summarize_order_items(items: list[dict[str, Any]]) -> str:
    return " + ".join(item["serviceType"] for item in items)


def summarize_order_quantity(items: list[dict[str, Any]]) -> str:
    if len(items) == 1:
        item = items[0]
        return f"{format_number(item['quantity'])} {item['unit']}"
    return f"{len(items)} بنود"


def build_order_header_fields(items: list[dict[str, Any]]) -> dict[str, float | str]:
    primary_item = items[0]
    return {
        "serviceType": primary_item["serviceType"],
        "unit": primary_item["unit"],
        "quantity": primary_item["quantity"],
        "unitPrice": primary_item["unitPrice"],
        "discount": primary_item["discount"],
    }


def row_to_order_payload(row: sqlite3.Row, items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    if items is None:
        items = fetch_order_items_map([row]).get(int(row["id"]), [])
    items_summary = summarize_order_items(items)
    quantity_summary = summarize_order_quantity(items)
    discount_total = round(sum(float(item["discount"]) for item in items), 2)

    if len(items) == 1:
        primary = items[0]
        service_type = primary["serviceType"]
        unit = primary["unit"]
        quantity = primary["quantity"]
        unit_price = primary["unitPrice"]
        discount = primary["discount"]
    else:
        service_type = items_summary
        unit = "بند"
        quantity = len(items)
        unit_price = 0.0
        discount = discount_total

    return {
        "id": row["id"],
        "invoiceNumber": row["invoice_number"],
        "team": row["team_username"],
        "teamName": row["team_name"],
        "serviceType": service_type,
        "unit": unit,
        "quantity": quantity,
        "unitPrice": unit_price,
        "discount": discount,
        "discountTotal": discount_total,
        "itemCount": len(items),
        "itemsSummary": items_summary,
        "quantitySummary": quantity_summary,
        "items": items,
        "totalPrice": row["total_price"],
        "customerPhone": row["customer_phone"],
        "paymentMethod": row["payment_method"],
        "cashAmount": row["cash_amount"],
        "networkAmount": row["network_amount"],
        "notes": row["notes"],
        "adminNote": row["admin_note"],
        "date": row["created_at"],
    }


def build_order_payloads(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    items_map = fetch_order_items_map(rows)
    return [row_to_order_payload(row, items_map.get(int(row["id"]), [])) for row in rows]


def validate_order_item_payload(raw_item: Any, *, item_index: int) -> dict[str, Any]:
    if not isinstance(raw_item, dict):
        raise ValueError(f"بيانات البند رقم {item_index} غير صالحة.")

    service = validate_text(str(raw_item.get("serviceType", "")), field_name=f"الخدمة في البند {item_index}", max_length=80)
    if service not in SERVICES:
        raise ValueError(f"الخدمة في البند {item_index} غير معروفة.")

    try:
        quantity = float(raw_item.get("quantity", 0))
        unit_price = float(raw_item.get("unitPrice", 0))
        discount = float(raw_item.get("discount", 0) or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"يوجد رقم غير صالح في البند {item_index}.") from exc

    if quantity <= 0:
        raise ValueError(f"الكمية في البند {item_index} يجب أن تكون أكبر من صفر.")
    if unit_price < 0:
        raise ValueError(f"سعر الوحدة في البند {item_index} غير صالح.")
    if discount < 0:
        raise ValueError(f"الخصم في البند {item_index} غير صالح.")

    service_info = SERVICES[service]
    if service_info.get("quantityLocked") and abs(quantity - 1.0) > 1e-9:
        raise ValueError(f"الخدمة في البند {item_index} تعتمد على سعر متفق عليه فقط ولا تقبل كمية مختلفة.")

    price_options = service_info.get("priceOptions") or []
    if price_options:
        allowed_prices = [float(option["price"]) for option in price_options]
        if all(abs(unit_price - allowed) > 1e-9 for allowed in allowed_prices):
            raise ValueError(f"سعر الخدمة في البند {item_index} يجب أن يكون أحد الأسعار المعتمدة.")

    subtotal = quantity * unit_price
    total = round(subtotal - discount, 2)
    if total < 0:
        raise ValueError(f"إجمالي البند {item_index} لا يمكن أن يكون سالبًا.")

    return build_order_item_payload(
        service_type=service,
        unit=service_info["unit"],
        quantity=quantity,
        unit_price=unit_price,
        discount=discount,
        total_price=total,
        sort_order=item_index - 1,
    )


def normalize_order_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_items = payload.get("items")
    if raw_items is None:
        raw_items = [payload]
    if not isinstance(raw_items, list):
        raise ValueError("بيانات البنود غير صالحة.")
    if not raw_items:
        raise ValueError("أضف بندًا واحدًا على الأقل في الفاتورة.")
    return [validate_order_item_payload(item, item_index=index + 1) for index, item in enumerate(raw_items)]


def replace_order_items(
    conn: sqlite3.Connection,
    order_id: int,
    items: list[dict[str, Any]],
    *,
    timestamp: str,
) -> None:
    conn.execute("DELETE FROM order_items WHERE order_id = ?", (order_id,))
    for index, item in enumerate(items):
        conn.execute(
            """
            INSERT INTO order_items (
                order_id, service_type, unit, quantity, unit_price, discount,
                total_price, sort_order, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_id,
                item["serviceType"],
                item["unit"],
                item["quantity"],
                item["unitPrice"],
                item["discount"],
                item["totalPrice"],
                index,
                timestamp,
                timestamp,
            ),
        )


def row_to_expense_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "amount": row["amount"],
        "createdByUsername": row["created_by_username"],
        "createdByName": row["created_by_name"],
        "date": row["created_at"],
    }


def row_to_team_expense_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "amount": row["amount"],
        "teamUsername": row["team_username"],
        "teamName": row["team_name"],
        "createdByUsername": row["created_by_username"],
        "createdByName": row["created_by_name"],
        "date": row["created_at"],
    }


def calc_stats(rows: list[sqlite3.Row]) -> dict[str, float | int]:
    total = cash = network = transfer = 0.0
    for row in rows:
        total += row["total_price"]
        method = row["payment_method"]
        if method == "كاش":
            cash += row["total_price"]
        elif method == "شبكة":
            network += row["total_price"]
        elif method == "تحويل":
            transfer += row["total_price"]
        elif method == "مختلط":
            cash += row["cash_amount"]
            network += row["network_amount"]
    return {
        "total": round(total, 2),
        "cash": round(cash, 2),
        "network": round(network, 2),
        "transfer": round(transfer, 2),
        "count": len(rows),
    }


def calc_expense_total(rows: list[sqlite3.Row]) -> dict[str, float | int]:
    total = sum(row["amount"] for row in rows)
    return {"total": round(total, 2), "count": len(rows)}


def list_orders_for_filters(
    user: dict[str, Any],
    query: dict[str, list[str]],
) -> list[sqlite3.Row]:
    sql = "SELECT * FROM orders WHERE 1=1"
    params: list[Any] = []
    if user["role"] == "team":
        sql += " AND team_username = ?"
        params.append(user["username"])
    else:
        team = query.get("team", [""])[0].strip()
        if team:
            sql += " AND team_username = ?"
            params.append(team)
    service = query.get("service", [""])[0].strip()
    payment = query.get("payment", [""])[0].strip()
    date_from = query.get("dateFrom", [""])[0].strip()
    date_to = query.get("dateTo", [""])[0].strip()
    search = query.get("search", [""])[0].strip().lower()

    if service:
        sql += """
        AND (
            service_type = ?
            OR EXISTS (
                SELECT 1 FROM order_items oi
                WHERE oi.order_id = orders.id AND oi.service_type = ?
            )
        )
        """
        params.extend([service, service])
    if payment:
        sql += " AND payment_method = ?"
        params.append(payment)
    if date_from:
        sql += " AND substr(created_at, 1, 10) >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND substr(created_at, 1, 10) <= ?"
        params.append(date_to)
    if search:
        sql += " AND (lower(invoice_number) LIKE ? OR customer_phone LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])

    sql += " ORDER BY created_at DESC, id DESC"
    with get_db() as conn:
        return conn.execute(sql, params).fetchall()


def list_expenses_for_filters(query: dict[str, list[str]]) -> list[sqlite3.Row]:
    sql = "SELECT * FROM expenses WHERE 1=1"
    params: list[Any] = []
    date_from = query.get("dateFrom", [""])[0].strip()
    date_to = query.get("dateTo", [""])[0].strip()
    search = query.get("search", [""])[0].strip().lower()

    if date_from:
        sql += " AND substr(created_at, 1, 10) >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND substr(created_at, 1, 10) <= ?"
        params.append(date_to)
    if search:
        sql += " AND lower(title) LIKE ?"
        params.append(f"%{search}%")

    sql += " ORDER BY created_at DESC, id DESC"
    with get_db() as conn:
        return conn.execute(sql, params).fetchall()


def list_team_expenses_for_filters(query: dict[str, list[str]]) -> list[sqlite3.Row]:
    sql = "SELECT * FROM team_expenses WHERE 1=1"
    params: list[Any] = []
    team = query.get("team", [""])[0].strip()
    date_from = query.get("dateFrom", [""])[0].strip()
    date_to = query.get("dateTo", [""])[0].strip()
    search = query.get("search", [""])[0].strip().lower()

    if team:
        sql += " AND team_username = ?"
        params.append(team)
    if date_from:
        sql += " AND substr(created_at, 1, 10) >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND substr(created_at, 1, 10) <= ?"
        params.append(date_to)
    if search:
        sql += " AND lower(title) LIKE ?"
        params.append(f"%{search}%")

    sql += " ORDER BY created_at DESC, id DESC"
    with get_db() as conn:
        return conn.execute(sql, params).fetchall()


def get_period_bounds(period: str) -> tuple[str, str]:
    current = now_local()
    if period == "today":
        start = current.strftime("%Y-%m-%d")
        end = start
    elif period == "month":
        start = current.strftime("%Y-%m-01")
        end = current.strftime("%Y-%m-%d")
    else:
        raise ValueError("الفترة غير صالحة.")
    return start, end


def fetch_rows_between(start: str, end: str, team_username: str | None = None) -> list[sqlite3.Row]:
    sql = "SELECT * FROM orders WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?"
    params: list[Any] = [start, end]
    if team_username:
        sql += " AND team_username = ?"
        params.append(team_username)
    sql += " ORDER BY created_at DESC"
    with get_db() as conn:
        return conn.execute(sql, params).fetchall()


def create_order(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    items = normalize_order_items(payload)
    header_fields = build_order_header_fields(items)
    total = round(sum(float(item["totalPrice"]) for item in items), 2)
    try:
        cash_amount = float(payload.get("cashAmount", 0) or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("يوجد رقم غير صالح في الفاتورة.") from exc

    payment_method = validate_text(str(payload.get("paymentMethod", "")), field_name="طريقة الدفع", max_length=20)
    if payment_method not in PAYMENT_METHODS:
        raise ValueError("طريقة الدفع غير صالحة.")

    if payment_method == "مختلط":
        if cash_amount < 0 or cash_amount > total:
            raise ValueError("مبلغ الكاش في الدفع المختلط غير صالح.")
        network_amount = round(total - cash_amount, 2)
    else:
        cash_amount = 0.0
        network_amount = 0.0

    customer_phone = normalize_phone(str(payload.get("customerPhone", "")))
    notes = validate_text(str(payload.get("notes", "")), field_name="الملاحظات")
    ts = iso_now()

    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO orders (
                team_username, team_name, service_type, unit, quantity, unit_price,
                discount, total_price, customer_phone, payment_method, cash_amount,
                network_amount, notes, admin_note, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
            """,
            (
                user["username"],
                user["name"],
                header_fields["serviceType"],
                header_fields["unit"],
                header_fields["quantity"],
                header_fields["unitPrice"],
                header_fields["discount"],
                total,
                customer_phone,
                payment_method,
                cash_amount,
                network_amount,
                notes,
                ts,
                ts,
            ),
        )
        order_id = cur.lastrowid
        replace_order_items(conn, order_id, items, timestamp=ts)
        invoice_number = f"CT-{now_local():%Y%m%d}-{order_id:06d}"
        conn.execute(
            "UPDATE orders SET invoice_number = ? WHERE id = ?",
            (invoice_number, order_id),
        )
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    assert row is not None
    return row_to_order_payload(row)


def create_expense(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    title = validate_text(str(payload.get("title", "")), field_name="وصف المصروف", max_length=180)
    if not title:
        raise ValueError("وصف المصروف مطلوب.")

    try:
        amount = float(payload.get("amount", 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("قيمة المصروف غير صالحة.") from exc

    if amount <= 0:
        raise ValueError("قيمة المصروف يجب أن تكون أكبر من صفر.")

    ts = iso_now()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO expenses (
                title, amount, created_by_username, created_by_name, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (title, round(amount, 2), user["username"], user["name"], ts, ts),
        )
        row = conn.execute("SELECT * FROM expenses WHERE id = ?", (cur.lastrowid,)).fetchone()
    assert row is not None
    return row_to_expense_payload(row)


def create_team_expense(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    title = validate_text(str(payload.get("title", "")), field_name="وصف مصروف الفريق", max_length=180)
    if not title:
        raise ValueError("وصف مصروف الفريق مطلوب.")

    team_username = sanitize_username(str(payload.get("teamUsername", "")))
    team_name = get_team_names().get(team_username)
    if not team_name:
        raise ValueError("الفريق غير معروف.")

    try:
        amount = float(payload.get("amount", 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("قيمة مصروف الفريق غير صالحة.") from exc

    if amount <= 0:
        raise ValueError("قيمة مصروف الفريق يجب أن تكون أكبر من صفر.")

    ts = iso_now()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO team_expenses (
                title, amount, team_username, team_name, created_by_username,
                created_by_name, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (title, round(amount, 2), team_username, team_name, user["username"], user["name"], ts, ts),
        )
        row = conn.execute("SELECT * FROM team_expenses WHERE id = ?", (cur.lastrowid,)).fetchone()
    assert row is not None
    return row_to_team_expense_payload(row)


def update_order(order_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if existing is None:
            raise LookupError("الفاتورة غير موجودة.")
        existing_items = fetch_order_items_map([existing]).get(order_id, [])

        item_fields = {"serviceType", "quantity", "unitPrice", "discount"}
        if "items" in payload:
            items = normalize_order_items(payload)
            items_changed = True
        elif any(field in payload for field in item_fields):
            if len(existing_items) != 1:
                raise ValueError("تعديل بنود الفاتورة المتعددة من هذه النافذة غير مدعوم حاليًا.")
            merged_item = {
                "serviceType": payload.get("serviceType", existing_items[0]["serviceType"]),
                "quantity": payload.get("quantity", existing_items[0]["quantity"]),
                "unitPrice": payload.get("unitPrice", existing_items[0]["unitPrice"]),
                "discount": payload.get("discount", existing_items[0]["discount"]),
            }
            items = normalize_order_items({"items": [merged_item]})
            items_changed = True
        else:
            items = existing_items
            items_changed = False

        header_fields = build_order_header_fields(items)
        total = round(sum(float(item["totalPrice"]) for item in items), 2)

        try:
            cash_amount = float(payload.get("cashAmount", existing["cash_amount"]))
        except (TypeError, ValueError) as exc:
            raise ValueError("يوجد رقم غير صالح في التعديل.") from exc

        payment_method = validate_text(
            str(payload.get("paymentMethod", existing["payment_method"])),
            field_name="طريقة الدفع",
            max_length=20,
        )
        if payment_method not in PAYMENT_METHODS:
            raise ValueError("طريقة الدفع غير صالحة.")

        if payment_method == "مختلط":
            if cash_amount < 0 or cash_amount > total:
                raise ValueError("مبلغ الكاش في الدفع المختلط غير صالح.")
            network_amount = round(total - cash_amount, 2)
        else:
            cash_amount = 0.0
            network_amount = 0.0

        customer_phone = normalize_phone(str(payload.get("customerPhone", existing["customer_phone"])))
        notes = validate_text(str(payload.get("notes", existing["notes"])), field_name="ملاحظات الفريق")
        admin_note = validate_text(str(payload.get("adminNote", existing["admin_note"])), field_name="ملاحظة الأدمن")
        ts = iso_now()

        conn.execute(
            """
            UPDATE orders
            SET service_type = ?, unit = ?, quantity = ?, unit_price = ?, discount = ?,
                total_price = ?, customer_phone = ?, payment_method = ?, cash_amount = ?,
                network_amount = ?, notes = ?, admin_note = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                header_fields["serviceType"],
                header_fields["unit"],
                header_fields["quantity"],
                header_fields["unitPrice"],
                header_fields["discount"],
                total,
                customer_phone,
                payment_method,
                cash_amount,
                network_amount,
                notes,
                admin_note,
                ts,
                order_id,
            ),
        )
        if items_changed:
            replace_order_items(conn, order_id, items, timestamp=ts)
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    assert row is not None
    return row_to_order_payload(row)


def delete_order(order_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM orders WHERE id = ?", (order_id,))


def delete_expense(expense_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))


def delete_team_expense(expense_id: int) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM team_expenses WHERE id = ?", (expense_id,))


class AppHandler(BaseHTTPRequestHandler):
    server_version = "CleanTimeServer/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "; ".join(
                [
                    "default-src 'self'",
                    "script-src 'self' https://cdn.jsdelivr.net",
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                    "font-src 'self' https://fonts.gstatic.com data:",
                    "img-src 'self' data:",
                    "connect-src 'self'",
                    "object-src 'none'",
                    "base-uri 'self'",
                    "frame-ancestors 'none'",
                    "form-action 'self'",
                ]
            ),
        )
        if SECURE_COOKIE:
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        super().end_headers()

    def send_json(
        self,
        payload: dict[str, Any] | list[Any],
        *,
        status: HTTPStatus = HTTPStatus.OK,
        headers: list[tuple[str, str]] | None = None,
    ) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for key, value in headers or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def send_text(self, message: str, *, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def serve_file(self, filename: str) -> None:
        target = (BASE_DIR / filename).resolve()
        if BASE_DIR not in target.parents and target != BASE_DIR:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", CONTENT_TYPES.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return
        self.handle_page_get(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_post(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_patch(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_delete(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_page_get(self, path: str) -> None:
        if path in {"", "/"}:
            user = get_user_by_session(self)
            if user:
                page = "/admin-dashboard.html" if user["role"] == "admin" else "/team-dashboard.html"
                self.redirect(page)
            else:
                self.redirect("/login.html")
            return

        if path == "/admin-dashboard.html":
            user = get_user_by_session(self)
            if user is None:
                self.redirect("/login.html")
                return
            if user["role"] != "admin":
                self.redirect("/team-dashboard.html")
                return
            self.serve_file("admin-dashboard.html")
            return

        if path == "/team-dashboard.html":
            user = get_user_by_session(self)
            if user is None:
                self.redirect("/login.html")
                return
            if user["role"] != "team":
                self.redirect("/admin-dashboard.html")
                return
            self.serve_file("team-dashboard.html")
            return

        public_files = {
            "/login.html": "login.html",
            "/shared.css": "shared.css",
            "/shared.js": "shared.js",
            "/login.js": "login.js",
        }
        filename = public_files.get(path)
        if filename:
            self.serve_file(filename)
            return
        if path.startswith("/static/"):
            static_target = path.lstrip("/")
            suffix = Path(static_target).suffix.lower()
            if suffix in CONTENT_TYPES:
                self.serve_file(static_target)
                return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_api_get(self, parsed: Any) -> None:
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/health":
            self.send_json({"ok": True, "serverTime": iso_now()})
            return

        if path == "/api/catalog":
            user = require_auth(self)
            if not user:
                return
            self.send_json({"services": SERVICES, "teams": get_team_names()})
            return

        if path == "/api/auth/me":
            user = get_user_by_session(self)
            if user is None:
                self.send_json({"authenticated": False})
            else:
                self.send_json(
                    {
                        "authenticated": True,
                        "user": {
                            "username": user["username"],
                            "role": user["role"],
                            "name": user["name"],
                        },
                        "csrfToken": user["csrf_token"],
                    }
                )
            return

        if path == "/api/orders":
            user = require_auth(self)
            if not user:
                return
            rows = list_orders_for_filters(user, query)
            self.send_json({"orders": build_order_payloads(rows)})
            return

        if path == "/api/expenses":
            user = require_auth(self, role="admin")
            if not user:
                return
            rows = list_expenses_for_filters(query)
            summary = calc_expense_total(rows)
            self.send_json(
                {
                    "expenses": [row_to_expense_payload(row) for row in rows],
                    "summary": summary,
                }
            )
            return

        if path == "/api/team-expenses":
            user = require_auth(self, role="admin")
            if not user:
                return
            rows = list_team_expenses_for_filters(query)
            summary = calc_expense_total(rows)
            self.send_json(
                {
                    "teamExpenses": [row_to_team_expense_payload(row) for row in rows],
                    "summary": summary,
                }
            )
            return

        if path == "/api/stats/dashboard":
            user = require_auth(self)
            if not user:
                return
            period = query.get("period", ["today"])[0]
            try:
                start, end = get_period_bounds(period)
            except ValueError as exc:
                self.send_json({"error": "bad_request", "message": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            rows = fetch_rows_between(start, end, None if user["role"] == "admin" else user["username"])
            stats = calc_stats(rows)
            recent = build_order_payloads(rows[:10])
            self.send_json({"stats": stats, "recentOrders": recent})
            return

        if path == "/api/stats/teams":
            user = require_auth(self, role="admin")
            if not user:
                return
            period = query.get("period", ["today"])[0]
            try:
                start, end = get_period_bounds(period)
            except ValueError as exc:
                self.send_json({"error": "bad_request", "message": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            rows = fetch_rows_between(start, end)
            items_map = fetch_order_items_map(rows)
            team_names = get_team_names()
            grouped: dict[str, dict[str, Any]] = {
                username: {"username": username, "name": name, "orders": []}
                for username, name in team_names.items()
            }
            for row in rows:
                grouped.setdefault(
                    row["team_username"],
                    {"username": row["team_username"], "name": row["team_name"], "orders": []},
                )["orders"].append(row)

            payload = []
            for username, info in grouped.items():
                team_rows = info["orders"]
                stats = calc_stats(team_rows)
                meters = round(
                    sum(
                        item["quantity"]
                        for row in team_rows
                        for item in items_map.get(int(row["id"]), [fallback_order_item_payload(row)])
                        if item["unit"] == "متر"
                    ),
                    1,
                )
                payload.append(
                    {
                        "username": username,
                        "name": info["name"],
                        "stats": stats,
                        "meters": meters,
                    }
                )
            payload.sort(key=lambda item: item["name"])
            self.send_json({"teams": payload})
            return

        if path == "/api/reports":
            user = require_auth(self, role="admin")
            if not user:
                return
            with get_db() as conn:
                rows = conn.execute("SELECT * FROM orders ORDER BY created_at DESC").fetchall()
                expenses_rows = conn.execute("SELECT * FROM expenses ORDER BY created_at DESC").fetchall()
                team_expenses_rows = conn.execute("SELECT * FROM team_expenses ORDER BY created_at DESC").fetchall()
            items_map = fetch_order_items_map(rows)
            team_names = get_team_names(include_inactive=True)

            total_stats = calc_stats(rows)
            today_start, today_end = get_period_bounds("today")
            today_rows = [row for row in rows if today_start <= row["created_at"][:10] <= today_end]
            today_stats = calc_stats(today_rows)
            month_start, month_end = get_period_bounds("month")
            month_rows = [row for row in rows if month_start <= row["created_at"][:10] <= month_end]
            month_stats = calc_stats(month_rows)
            total_expenses = calc_expense_total(expenses_rows)
            month_expense_rows = [row for row in expenses_rows if month_start <= row["created_at"][:10] <= month_end]
            month_expenses = calc_expense_total(month_expense_rows)
            total_team_expenses = calc_expense_total(team_expenses_rows)
            month_team_expense_rows = [row for row in team_expenses_rows if month_start <= row["created_at"][:10] <= month_end]
            month_team_expenses = calc_expense_total(month_team_expense_rows)

            payment_counts = {"كاش": 0, "شبكة": 0, "تحويل": 0, "مختلط": 0}
            service_counts: dict[str, int] = defaultdict(int)
            team_totals: dict[str, dict[str, Any]] = defaultdict(lambda: {"total": 0.0, "count": 0})
            team_expense_totals: dict[str, dict[str, Any]] = defaultdict(lambda: {"teamName": "", "total": 0.0, "count": 0})

            current_month = now_local().strftime("%Y-%m")
            days_in_month = now_local().day
            daily_totals = [0.0 for _ in range(days_in_month)]

            for row in rows:
                payment_counts[row["payment_method"]] = payment_counts.get(row["payment_method"], 0) + 1
                for item in items_map.get(int(row["id"]), [fallback_order_item_payload(row)]):
                    service_counts[item["serviceType"]] += 1
                team_totals[row["team_name"]]["total"] += row["total_price"]
                team_totals[row["team_name"]]["count"] += 1
                if row["created_at"].startswith(current_month):
                    day_index = int(row["created_at"][8:10]) - 1
                    if 0 <= day_index < len(daily_totals):
                        daily_totals[day_index] += row["total_price"]

            for row in team_expenses_rows:
                team_expense_totals[row["team_username"]]["teamName"] = row["team_name"]
                team_expense_totals[row["team_username"]]["total"] += row["amount"]
                team_expense_totals[row["team_username"]]["count"] += 1

            top_services = sorted(service_counts.items(), key=lambda item: item[1], reverse=True)[:6]
            ranking = sorted(
                (
                    {"name": name, "total": round(data["total"], 2), "count": data["count"]}
                    for name, data in team_totals.items()
                ),
                key=lambda item: item["total"],
                reverse=True,
            )
            team_expense_ranking = sorted(
                (
                    {
                        "teamUsername": username,
                        "teamName": data["teamName"] or team_names.get(username, username),
                        "total": round(data["total"], 2),
                        "count": data["count"],
                    }
                    for username, data in team_expense_totals.items()
                ),
                key=lambda item: item["total"],
                reverse=True,
            )

            self.send_json(
                {
                    "summary": {
                        "total": total_stats,
                        "today": today_stats,
                        "month": month_stats,
                        "expensesTotal": total_expenses,
                        "expensesMonth": month_expenses,
                        "teamExpensesTotal": total_team_expenses,
                        "teamExpensesMonth": month_team_expenses,
                        "netTotal": round(total_stats["total"] - total_expenses["total"] - total_team_expenses["total"], 2),
                        "netMonth": round(month_stats["total"] - month_expenses["total"] - month_team_expenses["total"], 2),
                    },
                    "paymentCounts": payment_counts,
                    "topServices": top_services,
                    "dailyTotals": [round(value, 2) for value in daily_totals],
                    "teamsRanking": ranking,
                    "teamExpensesRanking": team_expense_ranking,
                }
            )
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_api_post(self, parsed: Any) -> None:
        path = parsed.path
        if path == "/api/auth/login":
            # Early rate-limit check (IP only, before we know username)
            blocked, retry_after = too_many_attempts(self)
            if blocked:
                self.send_json(
                    {"error": "rate_limited", "message": "تم تجاوز عدد المحاولات، حاول لاحقًا."},
                    status=HTTPStatus.TOO_MANY_REQUESTS,
                    headers=[("Retry-After", str(retry_after))],
                )
                return
            try:
                payload = read_json(self)
                username = sanitize_username(str(payload.get("username", "")))
                password = str(payload.get("password", ""))
            except ValueError as exc:
                record_login_attempt(self)
                self.send_json({"error": "bad_request", "message": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return

            # Per-username rate-limit check
            blocked, retry_after = too_many_attempts(self, username)
            if blocked:
                self.send_json(
                    {"error": "rate_limited", "message": "تم تجاوز عدد المحاولات لهذا الحساب، حاول لاحقًا."},
                    status=HTTPStatus.TOO_MANY_REQUESTS,
                    headers=[("Retry-After", str(retry_after))],
                )
                return

            with get_db() as conn:
                purge_expired_sessions(conn)
                row = conn.execute(
                    """
                    SELECT id, username, password_hash, role, display_name, is_active
                    FROM users
                    WHERE username = ?
                    """,
                    (username,),
                ).fetchone()

            if row is None or not row["is_active"] or not verify_password(password, row["password_hash"]):
                record_login_attempt(self, username)
                self.send_json(
                    {"error": "invalid_credentials", "message": "اسم المستخدم أو كلمة المرور غير صحيحة."},
                    status=HTTPStatus.UNAUTHORIZED,
                )
                return

            clear_login_attempts(self, username)
            sec_log("login_success", ip=client_ip(self), username=username)
            session_id, csrf_token = create_session(row["id"])
            headers = set_cookie_headers(build_session_cookie(session_id, SESSION_TTL_HOURS * 3600))
            self.send_json(
                {
                    "authenticated": True,
                    "user": {
                        "username": row["username"],
                        "role": row["role"],
                        "name": row["display_name"],
                    },
                    "csrfToken": csrf_token,
                },
                headers=headers,
            )
            return

        if path == "/api/auth/logout":
            user = require_auth(self)
            if not user:
                return
            if not require_csrf(self, user):
                return
            destroy_session(user["session_id"])
            headers = set_cookie_headers(build_session_cookie("", 0))
            self.send_json({"ok": True}, headers=headers)
            return

        if path == "/api/orders":
            user = require_auth(self)
            if not user:
                return
            if not require_csrf(self, user):
                return
            if user["role"] not in {"team", "admin"}:
                self.send_json({"error": "forbidden", "message": "ليس لديك صلاحية."}, status=HTTPStatus.FORBIDDEN)
                return
            try:
                payload = read_json(self)
                order = create_order(payload, user)
            except ValueError as exc:
                self.send_json({"error": "bad_request", "message": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"order": order}, status=HTTPStatus.CREATED)
            return

        if path == "/api/expenses":
            user = require_auth(self, role="admin")
            if not user:
                return
            if not require_csrf(self, user):
                return
            try:
                payload = read_json(self)
                expense = create_expense(payload, user)
            except ValueError as exc:
                self.send_json({"error": "bad_request", "message": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"expense": expense}, status=HTTPStatus.CREATED)
            return

        if path == "/api/team-expenses":
            user = require_auth(self, role="admin")
            if not user:
                return
            if not require_csrf(self, user):
                return
            try:
                payload = read_json(self)
                team_expense = create_team_expense(payload, user)
            except ValueError as exc:
                self.send_json({"error": "bad_request", "message": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"teamExpense": team_expense}, status=HTTPStatus.CREATED)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_api_patch(self, parsed: Any) -> None:
        path = parsed.path
        if not path.startswith("/api/orders/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        user = require_auth(self, role="admin")
        if not user:
            return
        if not require_csrf(self, user):
            return

        try:
            order_id = int(path.rsplit("/", 1)[1])
            payload = read_json(self)
            order = update_order(order_id, payload)
        except ValueError as exc:
            self.send_json({"error": "bad_request", "message": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        except LookupError as exc:
            self.send_json({"error": "not_found", "message": str(exc)}, status=HTTPStatus.NOT_FOUND)
            return

        sec_log("order_updated", ip=client_ip(self), admin=user["username"], order_id=order_id)
        self.send_json({"order": order})

    def handle_api_delete(self, parsed: Any) -> None:
        path = parsed.path
        if path.startswith("/api/orders/"):
            user = require_auth(self, role="admin")
            if not user:
                return
            if not require_csrf(self, user):
                return
            try:
                order_id = int(path.rsplit("/", 1)[1])
            except ValueError:
                self.send_json({"error": "bad_request", "message": "رقم الفاتورة غير صالح."}, status=HTTPStatus.BAD_REQUEST)
                return

            delete_order(order_id)
            sec_log("order_deleted", ip=client_ip(self), admin=user["username"], order_id=order_id)
            self.send_json({"ok": True})
            return

        if path.startswith("/api/expenses/"):
            user = require_auth(self, role="admin")
            if not user:
                return
            if not require_csrf(self, user):
                return
            try:
                expense_id = int(path.rsplit("/", 1)[1])
            except ValueError:
                self.send_json({"error": "bad_request", "message": "رقم المصروف غير صالح."}, status=HTTPStatus.BAD_REQUEST)
                return

            delete_expense(expense_id)
            sec_log("expense_deleted", ip=client_ip(self), admin=user["username"], expense_id=expense_id)
            self.send_json({"ok": True})
            return

        if path.startswith("/api/team-expenses/"):
            user = require_auth(self, role="admin")
            if not user:
                return
            if not require_csrf(self, user):
                return
            try:
                expense_id = int(path.rsplit("/", 1)[1])
            except ValueError:
                self.send_json({"error": "bad_request", "message": "رقم مصروف الفريق غير صالح."}, status=HTTPStatus.BAD_REQUEST)
                return

            delete_team_expense(expense_id)
            sec_log("team_expense_deleted", ip=client_ip(self), admin=user["username"], expense_id=expense_id)
            self.send_json({"ok": True})
            return

        self.send_error(HTTPStatus.NOT_FOUND)


def random_password(length: int = 20) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%_-"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def ensure_demo_users() -> None:
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count:
        return
    admin_password = random_password()
    team_password = random_password()
    create_user("admin", admin_password, "admin", "مدير النظام")
    create_user("team1", team_password, "team", "الفريق الأول")
    credentials = (
        "\nتم إنشاء حسابات أولية آمنة:\n"
        f"admin / {admin_password}\n"
        f"team1 / {team_password}\n"
        "أنشئ أو غيّر الحسابات فورًا عبر أوامر create-user و reset-password.\n"
    )
    sys.stderr.write(credentials)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean Time secure local server")
    sub = parser.add_subparsers(dest="command")

    run = sub.add_parser("runserver", help="Run the local web server")
    run.add_argument("--host", default="127.0.0.1")
    run.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    run.add_argument("--bootstrap-demo-users", action="store_true")

    create = sub.add_parser("create-user", help="Create a new user")
    create.add_argument("--username", required=True)
    create.add_argument("--role", required=True, choices=sorted(ROLES))
    create.add_argument("--name", required=True)
    create.add_argument("--password")

    reset = sub.add_parser("reset-password", help="Reset a user's password")
    reset.add_argument("--username", required=True)
    reset.add_argument("--password")

    sub.add_parser("list-users", help="List current users")
    return parser.parse_args()


def cmd_create_user(args: argparse.Namespace) -> int:
    password = args.password or random_password()
    create_user(args.username, password, args.role, args.name)
    print(f"تم إنشاء المستخدم {args.username} بنجاح.")
    print(f"كلمة المرور: {password}")
    return 0


def cmd_reset_password(args: argparse.Namespace) -> int:
    password = args.password or random_password()
    reset_password(args.username, password)
    print(f"تم تحديث كلمة مرور {args.username}.")
    print(f"كلمة المرور الجديدة: {password}")
    return 0


def cmd_list_users() -> int:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT username, role, display_name, is_active, created_at FROM users ORDER BY role, username"
        ).fetchall()
    if not rows:
        print("لا يوجد مستخدمون بعد.")
        return 0
    for row in rows:
        status = "نشط" if row["is_active"] else "معطل"
        print(f"{row['username']} | {row['role']} | {row['display_name']} | {status} | {row['created_at']}")
    return 0


def cmd_runserver(args: argparse.Namespace) -> int:
    init_db()
    if args.bootstrap_demo_users:
        ensure_demo_users()
    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Clean Time server running on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()
    return 0


def main() -> int:
    args = parse_args()
    init_db()

    if args.command in (None, "runserver"):
        if args.command is None:
            args = argparse.Namespace(host="127.0.0.1", port=8000, bootstrap_demo_users=True)
        return cmd_runserver(args)
    if args.command == "create-user":
        return cmd_create_user(args)
    if args.command == "reset-password":
        return cmd_reset_password(args)
    if args.command == "list-users":
        return cmd_list_users()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
