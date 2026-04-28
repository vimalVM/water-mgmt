"""
Smart Water Management – Flask REST API
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import mysql.connector
import bcrypt
import jwt
import datetime
import random
import os
from functools import wraps
from config import Config

app = Flask(__name__)

# ── CORS: explicitly allow all methods so PUT/DELETE work from React ──
CORS(app,
     origins=Config.CORS_ORIGINS,
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     allow_headers=["Content-Type", "Authorization"],
     supports_credentials=True)

@app.after_request
def add_cors_headers(response):
    """Safety net: ensure CORS headers are present on every response."""
    origin = request.headers.get("Origin", "")
    if origin in Config.CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"]  = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    """
    Catch ALL unhandled exceptions, log them clearly, and return a JSON 500
    with CORS headers — so the browser always sees the real error, not a
    misleading 'CORS blocked' message.
    """
    import traceback
    traceback.print_exc()          # prints full stack trace to Flask terminal
    origin = request.headers.get("Origin", "")
    resp = jsonify({"error": str(e), "type": type(e).__name__})
    resp.status_code = 500
    if origin in Config.CORS_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"]  = origin
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return resp

@app.route("/users/<int:user_id>/limits", methods=["OPTIONS"])
def limits_preflight(user_id):
    """Handle OPTIONS preflight for PUT /users/<id>/limits explicitly."""
    return jsonify({}), 200

# ─────────────────────────────────────────────────────────────
# AUTO-MIGRATION — runs once on startup, safe to re-run
# ─────────────────────────────────────────────────────────────

def run_migrations():
    """
    Adds any missing columns to the users table.
    Uses IF NOT EXISTS style checks so it's safe to run every time.
    """
    migrations = [
        # Check and add each new column individually
        ("people_count",
         "ALTER TABLE users ADD COLUMN people_count INT NOT NULL DEFAULT 1 AFTER password"),
        ("base_green_per_person",
         "ALTER TABLE users ADD COLUMN base_green_per_person FLOAT NOT NULL DEFAULT 100 AFTER people_count"),
        ("base_orange_per_person",
         "ALTER TABLE users ADD COLUMN base_orange_per_person FLOAT NOT NULL DEFAULT 200 AFTER base_green_per_person"),
    ]

    conn = get_db()
    cur  = conn.cursor(dictionary=True)

    # Get current columns
    cur.execute("SHOW COLUMNS FROM users")
    existing_cols = {row["Field"] for row in cur.fetchall()}

    for col_name, alter_sql in migrations:
        if col_name not in existing_cols:
            print(f"[MIGRATION] Adding column: {col_name}")
            cur.execute(alter_sql)
            conn.commit()
        else:
            print(f"[MIGRATION] Column already exists, skipping: {col_name}")

    # Drop old redundant columns if they still exist
    for old_col in ["green_limit", "orange_limit"]:
        if old_col in existing_cols:
            print(f"[MIGRATION] Dropping redundant column: {old_col}")
            cur.execute(f"ALTER TABLE users DROP COLUMN {old_col}")
            conn.commit()

    cur.close()
    conn.close()
    print("[MIGRATION] Done.")

# NOTE: run_migrations() and startup_catchup() are called at the bottom
# of the file, after get_db / query / helpers are all defined.

# ─────────────────────────────────────────────────────────────
# CORE ARCHIVE HELPER  (used by scheduler, startup, simulator)
# ─────────────────────────────────────────────────────────────

def _do_archive_for_date(archive_date):
    """
    Archives tap_usage_running values into tap_daily_archive and
    system_daily_totals for the given date.
    Does NOT reset tap_usage_running — caller decides when to reset.
    Safe to call multiple times for the same date (upsert).
    """
    all_taps = query("SELECT tap_id, user_id FROM taps")

    for tap in all_taps:
        tap_id = tap["tap_id"]

        running = query(
            "SELECT current_usage FROM tap_usage_running WHERE tap_id=%s",
            (tap_id,), fetch="one",
        )
        usage = float(running["current_usage"]) if running else 0.0

        existing_arch = query(
            "SELECT id FROM tap_daily_archive WHERE tap_id=%s AND archive_date=%s",
            (tap_id, archive_date), fetch="one",
        )
        if existing_arch:
            query(
                "UPDATE tap_daily_archive SET usage_liters=%s WHERE tap_id=%s AND archive_date=%s",
                (usage, tap_id, archive_date), commit=True,
            )
        else:
            query(
                "INSERT INTO tap_daily_archive (tap_id, usage_liters, archive_date) VALUES (%s,%s,%s)",
                (tap_id, usage, archive_date), commit=True,
            )

    # Update system_daily_totals per user
    users = query("SELECT DISTINCT user_id FROM taps")
    for u in users:
        uid = u["user_id"]
        total_row = query(
            """
            SELECT COALESCE(SUM(a.usage_liters),0) AS total
            FROM   tap_daily_archive a
            JOIN   taps t ON t.tap_id = a.tap_id
            WHERE  t.user_id=%s AND a.archive_date=%s
            """,
            (uid, archive_date), fetch="one",
        )
        total = float(total_row["total"]) if total_row else 0.0

        try:
            limits = query(
                "SELECT people_count, base_green_per_person, base_orange_per_person FROM users WHERE user_id=%s",
                (uid,), fetch="one",
            )
        except Exception:
            limits = None
        green_limit, orange_limit = calc_limits(
            limits or {"people_count":1,"base_green_per_person":100,"base_orange_per_person":200}
        )
        color = get_color(total, green_limit, orange_limit)

        existing_tot = query(
            "SELECT id FROM system_daily_totals WHERE user_id=%s AND usage_date=%s",
            (uid, archive_date), fetch="one",
        )
        if existing_tot:
            query(
                "UPDATE system_daily_totals SET total_usage=%s, color_status=%s WHERE user_id=%s AND usage_date=%s",
                (total, color, uid, archive_date), commit=True,
            )
        else:
            query(
                "INSERT INTO system_daily_totals (user_id, total_usage, color_status, usage_date) VALUES (%s,%s,%s,%s)",
                (uid, total, color, archive_date), commit=True,
            )


def _reset_running_totals():
    """Zero out tap_usage_running after archiving."""
    query("UPDATE tap_usage_running SET current_usage=0.0, last_update=NOW()", commit=True)


# ─────────────────────────────────────────────────────────────
# STARTUP CATCHUP — fixes missed midnight archives
# ─────────────────────────────────────────────────────────────

def startup_catchup():
    """
    Runs every time Flask starts (BEFORE app.run).

    Handles two scenarios:
    1. tap_usage_running has data from a previous day (missed midnight archive).
       → Archives the accumulated total under the LAST ACTIVE date.
       → Inserts 0-usage records for any fully-missed dates in between.
       → Resets running totals to 0 so today starts fresh.
    2. tap_daily_archive has rows but system_daily_totals is missing them.
       → Backfills system_daily_totals for those dates.
    """
    today = datetime.date.today()
    print(f"[STARTUP] Running catchup check (today = {today})…")

    # ── Step 1: Detect stale running data from previous days ─────────────
    stale_rows = query(
        """
        SELECT r.tap_id, r.current_usage, DATE(r.last_update) AS last_date
        FROM   tap_usage_running r
        WHERE  DATE(r.last_update) < %s
          AND  r.current_usage > 0
        """,
        (today,),
    )

    if stale_rows:
        # Find the date range that was missed
        last_active_dates = set(r["last_date"] for r in stale_rows)
        earliest = min(last_active_dates)
        latest   = max(last_active_dates)

        print(f"[STARTUP] Stale data found — last active: {latest}, today: {today}")
        print(f"[STARTUP] Will archive accumulated total under {latest}, insert 0s for gap days.")

        # Archive accumulated total under the LAST ACTIVE date
        _do_archive_for_date(latest)
        print(f"[STARTUP] ✓ Archived usage for {latest}")

        # Insert 0-usage for every fully missed day between latest+1 and today-1
        gap_start = latest + datetime.timedelta(days=1)
        gap_end   = today  - datetime.timedelta(days=1)
        gap_date  = gap_start
        all_taps  = query("SELECT tap_id, user_id FROM taps")

        while gap_date <= gap_end:
            print(f"[STARTUP]   Inserting 0-usage for missed date: {gap_date}")
            for tap in all_taps:
                existing = query(
                    "SELECT id FROM tap_daily_archive WHERE tap_id=%s AND archive_date=%s",
                    (tap["tap_id"], gap_date), fetch="one",
                )
                if not existing:
                    query(
                        "INSERT INTO tap_daily_archive (tap_id, usage_liters, archive_date) VALUES (%s, 0.0, %s)",
                        (tap["tap_id"], gap_date), commit=True,
                    )
            gap_date += datetime.timedelta(days=1)

        # Reset running totals — today starts from 0
        _reset_running_totals()
        print(f"[STARTUP] Running totals reset. Today ({today}) starts from 0.")
    else:
        print("[STARTUP] No stale running data found.")

    # ── Step 2: Backfill system_daily_totals for any archive rows missing it ─
    orphaned = query(
        """
        SELECT DISTINCT a.archive_date
        FROM   tap_daily_archive a
        JOIN   taps t ON t.tap_id = a.tap_id
        WHERE  a.archive_date < %s
          AND  NOT EXISTS (
              SELECT 1 FROM system_daily_totals s
              WHERE  s.user_id = t.user_id AND s.usage_date = a.archive_date
          )
        ORDER  BY a.archive_date
        """,
        (today,),
    )

    if orphaned:
        print(f"[STARTUP] Backfilling system_daily_totals for {len(orphaned)} missing date(s).")
        all_users = query("SELECT DISTINCT user_id FROM taps")
        for row in orphaned:
            d = row["archive_date"]
            for u in all_users:
                uid = u["user_id"]
                total_row = query(
                    """
                    SELECT COALESCE(SUM(a.usage_liters),0) AS total
                    FROM   tap_daily_archive a
                    JOIN   taps t ON t.tap_id = a.tap_id
                    WHERE  t.user_id=%s AND a.archive_date=%s
                    """,
                    (uid, d), fetch="one",
                )
                total = float(total_row["total"]) if total_row else 0.0
                try:
                    limits = query(
                        "SELECT people_count, base_green_per_person, base_orange_per_person FROM users WHERE user_id=%s",
                        (uid,), fetch="one",
                    )
                except Exception:
                    limits = None
                gl, ol = calc_limits(
                    limits or {"people_count":1,"base_green_per_person":100,"base_orange_per_person":200}
                )
                color = get_color(total, gl, ol)
                existing = query(
                    "SELECT id FROM system_daily_totals WHERE user_id=%s AND usage_date=%s",
                    (uid, d), fetch="one",
                )
                if not existing:
                    query(
                        "INSERT INTO system_daily_totals (user_id, total_usage, color_status, usage_date) VALUES (%s,%s,%s,%s)",
                        (uid, total, color, d), commit=True,
                    )
            print(f"[STARTUP]   ✓ system_daily_totals filled for {d}")
    else:
        print("[STARTUP] system_daily_totals is up to date.")

    print("[STARTUP] Catchup complete.")


# ─────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────

def get_db():
    return mysql.connector.connect(
        host     = Config.MYSQL_HOST,
        user     = Config.MYSQL_USER,
        password = Config.MYSQL_PASSWORD,
        database = Config.MYSQL_DB,
        port     = Config.MYSQL_PORT,
        autocommit=False,
    )

def query(sql, params=None, fetch="all", commit=False):
    conn = get_db()
    cur  = conn.cursor(dictionary=True)
    cur.execute(sql, params or ())
    if commit:
        conn.commit()
        result = cur.lastrowid
    elif fetch == "one":
        result = cur.fetchone()
    else:
        result = cur.fetchall()
    cur.close()
    conn.close()
    return result

# ─────────────────────────────────────────────────────────────
# JWT auth decorator
# ─────────────────────────────────────────────────────────────

def token_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = None
        auth  = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth.split(" ")[1]
        if not token:
            return jsonify({"error": "Token missing"}), 401
        try:
            data = jwt.decode(token, Config.JWT_SECRET_KEY, algorithms=["HS256"])
            kwargs["current_user_id"] = data["user_id"]
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except Exception:
            return jsonify({"error": "Invalid token"}), 401
        return f(*args, **kwargs)
    return wrapper

def make_token(user_id):
    payload = {
        "user_id": user_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=Config.JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, Config.JWT_SECRET_KEY, algorithm="HS256")

# ─────────────────────────────────────────────────────────────
# Color status helper
# ─────────────────────────────────────────────────────────────

def get_color(total, green_limit, orange_limit):
    if total < green_limit:
        return "green"
    elif total < orange_limit:
        return "orange"
    return "red"

def calc_limits(user):
    """Derive green/orange limits from stored base-per-person × people_count."""
    people = user.get("people_count", 1) or 1
    green  = round((user.get("base_green_per_person",  100) or 100) * people, 2)
    orange = round((user.get("base_orange_per_person", 200) or 200) * people, 2)
    return green, orange

# ─────────────────────────────────────────────────────────────
# AUTH endpoints
# ─────────────────────────────────────────────────────────────

@app.route("/register", methods=["POST"])
def register():
    data        = request.get_json()
    name        = data.get("name", "").strip()
    email       = data.get("email", "").strip().lower()
    pwd         = data.get("password", "")
    people      = max(1, int(data.get("people_count", 1)))
    base_green  = float(data.get("base_green_per_person",  100))
    base_orange = float(data.get("base_orange_per_person", 200))

    if not name or not email or not pwd:
        return jsonify({"error": "All fields required"}), 400
    if base_green >= base_orange:
        return jsonify({"error": "Green limit must be less than orange limit"}), 400

    existing = query("SELECT user_id FROM users WHERE email=%s", (email,), fetch="one")
    if existing:
        return jsonify({"error": "Email already registered"}), 409

    hashed  = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()
    user_id = query(
        """INSERT INTO users
           (name, email, password, people_count, base_green_per_person, base_orange_per_person)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (name, email, hashed, people, base_green, base_orange),
        commit=True,
    )
    token = make_token(user_id)
    return jsonify({"message": "Registered", "token": token, "user_id": user_id, "name": name}), 201


@app.route("/login", methods=["POST"])
def login():
    data  = request.get_json()
    email = data.get("email", "").strip().lower()
    pwd   = data.get("password", "")

    user = query("SELECT * FROM users WHERE email=%s", (email,), fetch="one")
    if not user or not bcrypt.checkpw(pwd.encode(), user["password"].encode()):
        return jsonify({"error": "Invalid credentials"}), 401

    token = make_token(user["user_id"])
    return jsonify({
        "token":   token,
        "user_id": user["user_id"],
        "name":    user["name"],
        "email":   user["email"],
    })

# ─────────────────────────────────────────────────────────────
# USER endpoints
# ─────────────────────────────────────────────────────────────

@app.route("/users/<int:user_id>", methods=["GET"])
@token_required
def get_user(user_id, current_user_id):
    try:
        user = query(
            """SELECT user_id, name, email,
                      people_count, base_green_per_person, base_orange_per_person,
                      created_at
               FROM users WHERE user_id=%s""",
            (user_id,), fetch="one",
        )
    except Exception as e:
        if "Unknown column" in str(e):
            # Columns not migrated yet — fall back to defaults
            user = query(
                "SELECT user_id, name, email, created_at FROM users WHERE user_id=%s",
                (user_id,), fetch="one",
            )
            if user:
                user["people_count"]           = 1
                user["base_green_per_person"]  = 100.0
                user["base_orange_per_person"] = 200.0
        else:
            raise
    if not user:
        return jsonify({"error": "User not found"}), 404
    green_limit, orange_limit = calc_limits(user)
    return jsonify({**user, "green_limit": green_limit, "orange_limit": orange_limit})


@app.route("/users/<int:user_id>/limits", methods=["PUT"])
@token_required
def update_limits(user_id, current_user_id):
    data        = request.get_json()
    people      = max(1, int(data.get("people_count", 1)))
    base_green  = float(data.get("base_green_per_person",  100))
    base_orange = float(data.get("base_orange_per_person", 200))

    if base_green >= base_orange:
        return jsonify({"error": "Green limit per person must be less than Orange limit per person"}), 400

    try:
        query(
            """UPDATE users
               SET people_count=%s, base_green_per_person=%s, base_orange_per_person=%s
               WHERE user_id=%s""",
            (people, base_green, base_orange, user_id),
            commit=True,
        )
    except Exception as e:
        err = str(e)
        if "Unknown column" in err:
            return jsonify({
                "error": "DB migration not run. Open MySQL Workbench and execute:\n\n"
                         "ALTER TABLE users\n"
                         "  ADD COLUMN people_count INT NOT NULL DEFAULT 1 AFTER password,\n"
                         "  ADD COLUMN base_green_per_person FLOAT NOT NULL DEFAULT 100 AFTER people_count,\n"
                         "  ADD COLUMN base_orange_per_person FLOAT NOT NULL DEFAULT 200 AFTER base_green_per_person;"
            }), 500
        raise

    green_limit  = round(base_green  * people, 2)
    orange_limit = round(base_orange * people, 2)
    return jsonify({
        "message":      "Limits updated",
        "people_count": people,
        "green_limit":  green_limit,
        "orange_limit": orange_limit,
    })

# ─────────────────────────────────────────────────────────────
# TAP endpoints
# ─────────────────────────────────────────────────────────────

@app.route("/add-tap", methods=["POST"])
@token_required
def add_tap(current_user_id):
    data     = request.get_json()
    user_id  = data.get("user_id")
    tap_name = data.get("tap_name", "").strip()
    location = data.get("location", "General").strip()

    if not tap_name:
        return jsonify({"error": "tap_name required"}), 400

    tap_id = query(
        "INSERT INTO taps (user_id, tap_name, location) VALUES (%s,%s,%s)",
        (user_id, tap_name, location), commit=True,
    )
    # initialise running record
    query(
        "INSERT INTO tap_usage_running (tap_id, current_usage) VALUES (%s, 0.0)",
        (tap_id,), commit=True,
    )
    return jsonify({"message": "Tap added", "tap_id": tap_id}), 201


@app.route("/taps/<int:user_id>", methods=["GET"])
@token_required
def get_taps(user_id, current_user_id):
    taps = query(
        """
        SELECT t.tap_id, t.tap_name, t.location, t.tap_status,
               COALESCE(r.current_usage, 0) AS current_usage,
               r.last_update
        FROM   taps t
        LEFT JOIN tap_usage_running r ON r.tap_id = t.tap_id
        WHERE  t.user_id = %s
        ORDER BY t.tap_id
        """,
        (user_id,),
    )
    return jsonify(taps)


@app.route("/tap-on/<int:tap_id>", methods=["POST"])
@token_required
def tap_on(tap_id, current_user_id):
    query("UPDATE taps SET tap_status='ON' WHERE tap_id=%s", (tap_id,), commit=True)
    return jsonify({"message": f"Tap {tap_id} turned ON"})


@app.route("/tap-off/<int:tap_id>", methods=["POST"])
@token_required
def tap_off(tap_id, current_user_id):
    query("UPDATE taps SET tap_status='OFF' WHERE tap_id=%s", (tap_id,), commit=True)
    return jsonify({"message": f"Tap {tap_id} turned OFF"})


@app.route("/delete-tap/<int:tap_id>", methods=["DELETE"])
@token_required
def delete_tap(tap_id, current_user_id):
    query("DELETE FROM taps WHERE tap_id=%s", (tap_id,), commit=True)
    return jsonify({"message": "Tap deleted"})

# ─────────────────────────────────────────────────────────────
# DASHBOARD endpoint
# ─────────────────────────────────────────────────────────────

@app.route("/dashboard/<int:user_id>", methods=["GET"])
@token_required
def dashboard(user_id, current_user_id):
    try:
        user = query(
            "SELECT people_count, base_green_per_person, base_orange_per_person FROM users WHERE user_id=%s",
            (user_id,), fetch="one",
        )
    except Exception as e:
        if "Unknown column" in str(e):
            user = {"people_count": 1, "base_green_per_person": 100.0, "base_orange_per_person": 200.0}
        else:
            raise
    if not user:
        return jsonify({"error": "User not found"}), 404
    green_limit, orange_limit = calc_limits(user)

    today        = datetime.date.today()
    yesterday    = today - datetime.timedelta(days=1)

    # Today's total running usage across all taps
    today_total = float(query(
        """
        SELECT COALESCE(SUM(r.current_usage), 0) AS total
        FROM   tap_usage_running r
        JOIN   taps t ON t.tap_id = r.tap_id
        WHERE  t.user_id = %s
        """,
        (user_id,), fetch="one",
    )["total"] or 0)

    # Yesterday total — try system_daily_totals first, fall back to tap_daily_archive
    yesterday_row = query(
        "SELECT COALESCE(total_usage, 0) AS total FROM system_daily_totals WHERE user_id=%s AND usage_date=%s",
        (user_id, yesterday), fetch="one",
    )
    if yesterday_row:
        yesterday_total = float(yesterday_row["total"] or 0)
    else:
        # Fallback: sum from tap_daily_archive directly
        arch_row = query(
            """
            SELECT COALESCE(SUM(a.usage_liters), 0) AS total
            FROM   tap_daily_archive a
            JOIN   taps t ON t.tap_id = a.tap_id
            WHERE  t.user_id = %s AND a.archive_date = %s
            """,
            (user_id, yesterday), fetch="one",
        )
        yesterday_total = float(arch_row["total"] or 0) if arch_row else 0.0

    # Per-tap running usage
    tap_usage = query(
        """
        SELECT t.tap_id, t.tap_name, t.location, t.tap_status,
               COALESCE(r.current_usage, 0) AS usage_today
        FROM   taps t
        LEFT JOIN tap_usage_running r ON r.tap_id = t.tap_id
        WHERE  t.user_id = %s
        ORDER BY t.tap_id
        """,
        (user_id,),
    )

    color = get_color(today_total, green_limit, orange_limit)

    change_pct = 0
    if yesterday_total > 0:
        change_pct = round(((today_total - yesterday_total) / yesterday_total) * 100, 1)

    return jsonify({
        "today_total":     round(today_total, 2),
        "yesterday_total": round(yesterday_total, 2),
        "color_status":    color,
        "green_limit":     green_limit,
        "orange_limit":    orange_limit,
        "change_pct":      change_pct,
        "tap_usage":       tap_usage,
    })

# ─────────────────────────────────────────────────────────────
# ANALYTICS / REPORTS endpoints
# ─────────────────────────────────────────────────────────────

@app.route("/usage-timeseries/<int:user_id>", methods=["GET"])
@token_required
def usage_timeseries(user_id, current_user_id):
    hours = int(request.args.get("hours", 24))

    # Auto-select bucket size so chart never gets too dense
    # ≤6h  → 5-min buckets  (max ~72 points)
    # ≤24h → 15-min buckets (max ~96 points)
    # ≤48h → 30-min buckets (max ~96 points)
    # >48h → 60-min buckets (max ~72 points per day)
    if hours <= 6:
        bucket_mins = 5
    elif hours <= 24:
        bucket_mins = 15
    elif hours <= 48:
        bucket_mins = 30
    else:
        bucket_mins = 60

    rows = query(
        """
        SELECT
            CONCAT(
                LPAD(HOUR(ts.recorded_at), 2, '0'), ':',
                LPAD(FLOOR(MINUTE(ts.recorded_at) / %s) * %s, 2, '0')
            )                              AS time_bucket,
            ROUND(SUM(ts.usage_liters), 2) AS total_liters,
            MIN(ts.recorded_at)            AS sort_time
        FROM   tap_usage_timeseries ts
        JOIN   taps t ON t.tap_id = ts.tap_id
        WHERE  t.user_id = %s
          AND  ts.recorded_at >= NOW() - INTERVAL %s HOUR
        GROUP  BY time_bucket
        ORDER  BY sort_time ASC
        """,
        (bucket_mins, bucket_mins, user_id, hours),
    )
    return jsonify({
        "bucket_mins": bucket_mins,
        "data": [{"time_bucket": r["time_bucket"], "total_liters": float(r["total_liters"] or 0)} for r in rows],
    })


@app.route("/daily-usage/<int:user_id>", methods=["GET"])
@token_required
def daily_usage(user_id, current_user_id):
    days = int(request.args.get("days", 30))

    # ── Past archived days (excludes today) ───────────────────
    archived = query(
        """
        SELECT usage_date AS date, total_usage, color_status
        FROM   system_daily_totals
        WHERE  user_id = %s
          AND  usage_date >= CURDATE() - INTERVAL %s DAY
          AND  usage_date < CURDATE()
        ORDER  BY usage_date ASC
        """,
        (user_id, days),
    )

    # ── Today's live running total ────────────────────────────
    today_row = query(
        """
        SELECT COALESCE(SUM(r.current_usage), 0) AS total
        FROM   tap_usage_running r
        JOIN   taps t ON t.tap_id = r.tap_id
        WHERE  t.user_id = %s
        """,
        (user_id,), fetch="one",
    )
    today_total = float(today_row["total"]) if today_row else 0.0

    try:
        user = query(
            "SELECT people_count, base_green_per_person, base_orange_per_person FROM users WHERE user_id=%s",
            (user_id,), fetch="one",
        )
    except Exception:
        user = {"people_count":1,"base_green_per_person":100,"base_orange_per_person":200}

    green_limit, orange_limit = calc_limits(user or {"people_count":1,"base_green_per_person":100,"base_orange_per_person":200})
    today_color = get_color(today_total, green_limit, orange_limit)

    # Merge: archived history + today live — cast dates/decimals to safe JSON types
    result = [
        {
            "date":         str(r["date"]),
            "total_usage":  round(float(r["total_usage"] or 0), 2),
            "color_status": r["color_status"],
            "is_live":      False,
        }
        for r in archived
    ] + [{
        "date":         str(datetime.date.today()),
        "total_usage":  round(today_total, 2),
        "color_status": today_color,
        "is_live":      True,
    }]

    return jsonify(result)


@app.route("/hourly-pattern/<int:user_id>", methods=["GET"])
@token_required
def hourly_pattern(user_id, current_user_id):
    """Average usage per hour-of-day across last N days — used for the heatmap."""
    days = int(request.args.get("days", 30))
    rows = query(
        """
        SELECT
            HOUR(ts.recorded_at)           AS hour_of_day,
            ROUND(SUM(ts.usage_liters), 2) AS total_liters,
            COUNT(DISTINCT DATE(ts.recorded_at)) AS active_days
        FROM   tap_usage_timeseries ts
        JOIN   taps t ON t.tap_id = ts.tap_id
        WHERE  t.user_id = %s
          AND  ts.recorded_at >= NOW() - INTERVAL %s DAY
        GROUP  BY hour_of_day
        ORDER  BY hour_of_day ASC
        """,
        (user_id, days),
    )
    hour_map = {r["hour_of_day"]: r for r in rows}
    result = []
    for h in range(24):
        r       = hour_map.get(h, {"hour_of_day": h, "total_liters": 0, "active_days": 1})
        total   = float(r["total_liters"] or 0)
        days_ct = int(r["active_days"] or 1)
        avg     = round(total / max(days_ct, 1), 2)
        result.append({
            "hour":         h,
            "label":        f"{h:02d}:00",
            "total_liters": round(total, 2),
            "avg_liters":   avg,
        })
    return jsonify(result)

@app.route("/today-hourly/<int:user_id>", methods=["GET"])
@token_required
def today_hourly(user_id, current_user_id):
    """Hourly usage breakdown for TODAY only — used for the 24h scrollable line chart."""
    rows = query(
        """
        SELECT
            HOUR(ts.recorded_at)           AS hour_num,
            ROUND(SUM(ts.usage_liters), 2) AS total_liters
        FROM   tap_usage_timeseries ts
        JOIN   taps t ON t.tap_id = ts.tap_id
        WHERE  t.user_id = %s
          AND  DATE(ts.recorded_at) = CURDATE()
        GROUP  BY hour_num
        ORDER  BY hour_num ASC
        """,
        (user_id,),
    )
    hour_map = {r["hour_num"]: float(r["total_liters"] or 0) for r in rows}
    result = [
        { "hour": h, "label": f"{h:02d}:00", "liters": hour_map.get(h, 0) }
        for h in range(24)
    ]
    return jsonify(result)



@app.route("/usage-by-tap/<int:user_id>", methods=["GET"])
@token_required
def usage_by_tap(user_id, current_user_id):
    days = int(request.args.get("days", 7))

    # ── Archived past days (excludes today) ───────────────────
    archived = query(
        """
        SELECT t.tap_id, t.tap_name, t.location,
               COALESCE(SUM(a.usage_liters), 0) AS archived_usage
        FROM   taps t
        LEFT JOIN tap_daily_archive a
               ON a.tap_id = t.tap_id
              AND a.archive_date >= CURDATE() - INTERVAL %s DAY
              AND a.archive_date < CURDATE()
        WHERE  t.user_id = %s
        GROUP  BY t.tap_id, t.tap_name, t.location
        """,
        (days, user_id),
    )

    # ── Today's live running usage ────────────────────────────
    live = query(
        """
        SELECT t.tap_id, COALESCE(r.current_usage, 0) AS live_usage
        FROM   taps t
        LEFT JOIN tap_usage_running r ON r.tap_id = t.tap_id
        WHERE  t.user_id = %s
        """,
        (user_id,),
    )
    live_map = {row["tap_id"]: row["live_usage"] for row in live}

    # Combine: archived + today's live — cast to float (MySQL SUM returns Decimal)
    result = []
    for row in archived:
        archived_val = float(row["archived_usage"] or 0)
        live_val     = float(live_map.get(row["tap_id"], 0) or 0)
        total        = round(archived_val + live_val, 2)
        result.append({
            "tap_name":    row["tap_name"],
            "location":    row["location"],
            "total_usage": total,
        })

    result.sort(key=lambda x: x["total_usage"], reverse=True)
    return jsonify(result)


@app.route("/export-csv/<int:user_id>", methods=["GET"])
def export_csv(user_id):
    import io, csv
    from flask import Response

    # Accept token via query param (browser downloads can't set headers)
    token = request.args.get("token") or request.headers.get("Authorization","").replace("Bearer ","")
    if not token:
        return jsonify({"error": "Token missing"}), 401
    try:
        jwt.decode(token, Config.JWT_SECRET_KEY, algorithms=["HS256"])
    except Exception:
        return jsonify({"error": "Invalid or expired token"}), 401

    days = int(request.args.get("days", 30))

    # Archived historical rows
    rows = query(
        """
        SELECT CAST(a.archive_date AS CHAR) AS archive_date,
               t.tap_name, t.location,
               ROUND(a.usage_liters, 3) AS usage_liters
        FROM   tap_daily_archive a
        JOIN   taps t ON t.tap_id = a.tap_id
        WHERE  t.user_id = %s
          AND  a.archive_date >= CURDATE() - INTERVAL %s DAY
        ORDER  BY a.archive_date DESC, t.tap_name
        """,
        (user_id, days),
    )

    # Today's live running rows (not yet archived)
    live_rows = query(
        """
        SELECT t.tap_name, t.location,
               ROUND(COALESCE(r.current_usage, 0), 3) AS usage_liters
        FROM   taps t
        LEFT JOIN tap_usage_running r ON r.tap_id = t.tap_id
        WHERE  t.user_id = %s
        ORDER  BY t.tap_name
        """,
        (user_id,),
    )
    today_str = str(datetime.date.today())
    live_csv  = [{"archive_date": today_str + " (live)",
                  "tap_name": r["tap_name"],
                  "location": r["location"],
                  "usage_liters": float(r["usage_liters"] or 0)} for r in live_rows]

    all_rows = live_csv + [dict(r) for r in rows]

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["archive_date","tap_name","location","usage_liters"])
    writer.writeheader()
    writer.writerows(all_rows)

    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=aquatrack_usage_{today_str}.csv",
            "Access-Control-Allow-Origin": "*",
        },
    )

# ─────────────────────────────────────────────────────────────
# SIMULATE USAGE (manual HTTP trigger — delegates to _simulate_tick
# which is defined below alongside the background threads)
# ─────────────────────────────────────────────────────────────

@app.route("/simulate-usage", methods=["POST"])
def simulate_usage():
    """HTTP endpoint: delegates to the shared _simulate_tick() function."""
    result = _simulate_tick()
    return jsonify(result)

# ─────────────────────────────────────────────────────────────
# ARCHIVE DAILY DATA (midnight scheduler)
# ─────────────────────────────────────────────────────────────

@app.route("/archive-daily-data", methods=["POST"])
def archive_daily_data():
    """Called at midnight by scheduler.py."""
    archive_date = datetime.date.today()
    _do_archive_for_date(archive_date)
    _reset_running_totals()
    return jsonify({"message": "Archive complete", "date": str(archive_date)})


@app.route("/flow-status/<int:user_id>", methods=["GET"])
@token_required
def flow_status(user_id, current_user_id):
    """Returns whether the AI throttle is active for this user."""
    try:
        tot = query(
            """SELECT COALESCE(SUM(r.current_usage),0) AS total
               FROM tap_usage_running r JOIN taps t ON t.tap_id=r.tap_id
               WHERE t.user_id=%s""",
            (user_id,), fetch="one",
        )
        today_total = float(tot["total"] or 0)
        ul = query(
            "SELECT people_count, base_green_per_person, base_orange_per_person FROM users WHERE user_id=%s",
            (user_id,), fetch="one",
        )
        green_lim, orange_lim = calc_limits(ul or {})
        throttled = today_total >= green_lim
        return jsonify({
            "today_total":  round(today_total, 2),
            "green_limit":  green_lim,
            "orange_limit": orange_lim,
            "throttled":    throttled,
            "speed_mode":   "throttled (30%)" if throttled else "normal (100%)",
            "message":      "⚠️ AI throttle active — flow reduced to 30% (green limit exceeded)" if throttled
                            else "✅ Normal flow — within green limit",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────
# SETUP page – System Setup
# ─────────────────────────────────────────────────────────────

@app.route("/setup/<int:user_id>", methods=["GET"])
@token_required
def get_setup(user_id, current_user_id):
    taps = query(
        "SELECT tap_id, tap_name, location, tap_status FROM taps WHERE user_id=%s",
        (user_id,),
    )
    user = query(
        "SELECT people_count, base_green_per_person, base_orange_per_person FROM users WHERE user_id=%s",
        (user_id,), fetch="one",
    )
    green_limit, orange_limit = calc_limits(user)
    return jsonify({"taps": taps, **user, "green_limit": green_limit, "orange_limit": orange_limit})


@app.route("/catchup-archive", methods=["POST"])
def catchup_archive():
    """
    Manual trigger: archives any stale running data from previous days,
    resets running totals, and backfills system_daily_totals.
    Call this if you suspect a midnight archive was missed.
    """
    try:
        startup_catchup()
        return jsonify({"message": "Catchup complete — check Flask terminal for details."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────
# BACKGROUND THREADS — scheduler + simulator (replaces
# standalone scheduler.py and simulator.py)
# ─────────────────────────────────────────────────────────────

import threading
import time as _time

_threads_started = False  # guard against double-start (dev reloader)


def _scheduler_thread():
    """Background thread: archives data at midnight daily."""
    import schedule as sched_lib

    def _midnight_archive():
        try:
            archive_date = datetime.date.today()
            print(f"[SCHEDULER] Running midnight archive for {archive_date}")
            _do_archive_for_date(archive_date)
            _reset_running_totals()
            print(f"[SCHEDULER] Archive complete for {archive_date}")
        except Exception as exc:
            print(f"[SCHEDULER] Error: {exc}")

    sched_lib.every().day.at("00:00").do(_midnight_archive)
    print("[SCHEDULER] Background scheduler started — will archive at midnight")

    while True:
        sched_lib.run_pending()
        _time.sleep(30)


def _simulate_tick():
    """
    Core simulation logic — adds random usage to all ON taps.
    Called by the background thread and the /simulate-usage endpoint.
    Returns a dict with results.
    """
    today = datetime.date.today()

    # ── Day-rollover check ────────────────────────────────────────────────
    stale = query(
        """
        SELECT tap_id, current_usage, DATE(last_update) AS last_date
        FROM   tap_usage_running
        WHERE  DATE(last_update) < %s AND current_usage > 0
        """,
        (today,),
    )
    if stale:
        past_dates = set(r["last_date"] for r in stale)
        for past_date in sorted(past_dates):
            print(f"[SIMULATE] Day rollover detected — archiving {past_date}")
            _do_archive_for_date(past_date)
        _reset_running_totals()
        print(f"[SIMULATE] Reset complete. Today ({today}) starts from 0.")

    # ── Normal simulation with AI speed throttle ─────────────────────────
    on_taps = query(
        """
        SELECT t.tap_id, t.user_id
        FROM   taps t
        WHERE  t.tap_status='ON'
        """
    )

    if not on_taps:
        return {"message": "Simulated 0 tap(s) — no taps are ON",
                "taps_on": 0, "speed_mode": "normal"}

    # Per-user: check if today_total has crossed green_limit → throttle flow
    user_totals = {}
    user_limits = {}
    for row in on_taps:
        uid = row["user_id"]
        if uid not in user_totals:
            tot = query(
                """SELECT COALESCE(SUM(r.current_usage),0) AS total
                   FROM tap_usage_running r JOIN taps t ON t.tap_id=r.tap_id
                   WHERE t.user_id=%s""",
                (uid,), fetch="one",
            )
            user_totals[uid] = float(tot["total"] or 0)
            try:
                ul = query(
                    "SELECT people_count, base_green_per_person, base_orange_per_person FROM users WHERE user_id=%s",
                    (uid,), fetch="one",
                )
                user_limits[uid] = calc_limits(ul or {})
            except Exception:
                user_limits[uid] = (100.0, 200.0)

    ticked   = 0
    throttled = 0
    for row in on_taps:
        tap_id = row["tap_id"]
        uid    = row["user_id"]

        green_lim, _ = user_limits.get(uid, (100.0, 200.0))
        today_total  = user_totals.get(uid, 0)

        # AI throttle: if usage exceeded green_limit, reduce flow to 30% of normal
        if today_total >= green_lim:
            amount = round(random.uniform(
                Config.SIMULATE_MIN_LITERS * 0.3,
                Config.SIMULATE_MAX_LITERS * 0.3,
            ), 3)
            throttled += 1
        else:
            amount = round(random.uniform(
                Config.SIMULATE_MIN_LITERS,
                Config.SIMULATE_MAX_LITERS,
            ), 3)
        ticked += 1

        query(
            "INSERT INTO tap_usage_timeseries (tap_id, usage_liters) VALUES (%s, %s)",
            (tap_id, amount), commit=True,
        )
        existing = query(
            "SELECT tap_id FROM tap_usage_running WHERE tap_id=%s",
            (tap_id,), fetch="one",
        )
        if existing:
            query(
                "UPDATE tap_usage_running SET current_usage=current_usage+%s, last_update=NOW() WHERE tap_id=%s",
                (amount, tap_id), commit=True,
            )
        else:
            query(
                "INSERT INTO tap_usage_running (tap_id, current_usage) VALUES (%s,%s)",
                (tap_id, amount), commit=True,
            )

    speed_mode = "throttled" if throttled > 0 else "normal"
    return {
        "message":     f"Simulated {ticked} tap(s)",
        "taps_on":     ticked,
        "speed_mode":  speed_mode,
        "throttled":   throttled,
    }


def _simulator_thread():
    """Background thread: simulates water usage every N seconds."""
    interval = Config.SIMULATE_INTERVAL_SECONDS
    tick = 0
    print(f"[SIMULATOR] Background simulator started — ticking every {interval}s")

    # First tick immediately
    _time.sleep(2)  # brief pause so Flask is fully ready
    tick += 1
    try:
        result = _simulate_tick()
        taps_on = result.get("taps_on", 0)
        if taps_on == 0:
            print(f"[SIMULATOR] Tick #{tick} → {result.get('message', '')}  "
                  "Turn a tap ON in the browser to start simulation.")
        else:
            print(f"[SIMULATOR] Tick #{tick} → SUCCESS: {result.get('message', '')}")
    except Exception as exc:
        print(f"[SIMULATOR] Tick #{tick} → Error: {exc}")

    while True:
        _time.sleep(interval)
        tick += 1
        try:
            result = _simulate_tick()
            taps_on = result.get("taps_on", 0)
            if taps_on == 0:
                print(f"[SIMULATOR] Tick #{tick} → {result.get('message', '')}  "
                      "Turn a tap ON in the browser to start simulation.")
            else:
                print(f"[SIMULATOR] Tick #{tick} → SUCCESS: {result.get('message', '')}")
        except Exception as exc:
            print(f"[SIMULATOR] Tick #{tick} → Error: {exc}")


def start_background_threads():
    """Start scheduler + simulator daemon threads (called once)."""
    global _threads_started
    if _threads_started:
        return
    _threads_started = True

    # Always start the scheduler (midnight archive)
    t1 = threading.Thread(target=_scheduler_thread, daemon=True, name="scheduler")
    t1.start()

    # Start simulator only if enabled
    if Config.ENABLE_SIMULATOR:
        t2 = threading.Thread(target=_simulator_thread, daemon=True, name="simulator")
        t2.start()
    else:
        print("[SIMULATOR] Disabled via ENABLE_SIMULATOR=false")


# ─────────────────────────────────────────────────────────────
# STARTUP — runs in both dev (app.run) and production (gunicorn)
# ─────────────────────────────────────────────────────────────

def _run_startup():
    """Run migrations, catchup, and start background threads."""
    try:
        run_migrations()
    except Exception as e:
        print(f"[MIGRATION] Warning: {e}")
    try:
        startup_catchup()
    except Exception as e:
        print(f"[STARTUP] Warning: {e}")
    start_background_threads()


# For gunicorn: run startup when the module is imported
# (gunicorn imports app.py as a module, never hits __main__)
_run_startup()


if __name__ == "__main__":
    # Dev mode — use_reloader=False to avoid double thread start
    port = int(os.getenv("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port, use_reloader=False)

