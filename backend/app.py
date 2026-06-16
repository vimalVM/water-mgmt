"""
Smart Water Management – Flask REST API (Firebase Firestore)
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import bcrypt
import jwt
import datetime
import random
import os
import csv
import io
import threading
import time as _time
from functools import wraps

import firebase_admin
from firebase_admin import credentials, firestore

from config import Config
from ml_models import GradientBoostedForecaster, TapUsagePredictor

app = Flask(__name__)

CORS(app,
     origins=Config.CORS_ORIGINS,
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     allow_headers=["Content-Type", "Authorization"],
     supports_credentials=True)

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    if origin in Config.CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"]  = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    traceback.print_exc()
    origin = request.headers.get("Origin", "")
    resp = jsonify({"error": str(e), "type": type(e).__name__})
    resp.status_code = 500
    if origin in Config.CORS_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"]  = origin
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return resp

@app.route("/users/<user_id>/limits", methods=["OPTIONS"])
def limits_preflight(user_id):
    return jsonify({}), 200

# ─────────────────────────────────────────────────────────────
# FIREBASE INIT & HELPERS
# ─────────────────────────────────────────────────────────────

if not firebase_admin._apps:
    cred_path = Config.FIREBASE_CREDENTIALS_PATH
    use_emulator = os.getenv("USE_EMULATOR", "false").lower() == "true" or not os.path.exists(cred_path)
    
    if use_emulator:
        print("[FIREBASE] Using Firestore Emulator fallback...")
        if "FIRESTORE_EMULATOR_HOST" not in os.environ:
            os.environ["FIRESTORE_EMULATOR_HOST"] = "127.0.0.1:8080"
        try:
            from cryptography.hazmat.primitives.asymmetric import rsa
            from cryptography.hazmat.primitives import serialization
            pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            pem = pk.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption()
            ).decode('utf-8')
            cred = credentials.Certificate({
                'type': 'service_account',
                'project_id': 'demo-water-mgmt',
                'private_key_id': 'dummy',
                'private_key': pem,
                'client_email': 'dummy@demo-water-mgmt.iam.gserviceaccount.com',
                'client_id': 'dummy',
                'token_uri': 'https://oauth2.googleapis.com/token'
            })
            firebase_admin.initialize_app(cred)
        except Exception as e:
            print(f"[FIREBASE] Failed to generate dummy credential: {e}")
    else:
        try:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        except Exception as e:
            print(f"[FIREBASE] Error initializing with {cred_path}: {e}")

def get_db():
    if not firebase_admin._apps:
        raise Exception("Firebase not initialized.")
    return firestore.client()

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

    db = get_db()
    users_ref = db.collection('users')
    existing = users_ref.where('email', '==', email).get()
    if existing:
        return jsonify({"error": "Email already registered"}), 409

    hashed  = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()
    
    new_user_ref = users_ref.document()
    user_id = new_user_ref.id
    new_user_ref.set({
        "user_id": user_id,
        "name": name,
        "email": email,
        "password": hashed,
        "people_count": people,
        "base_green_per_person": base_green,
        "base_orange_per_person": base_orange,
        "created_at": datetime.datetime.utcnow()
    })
    
    token = make_token(user_id)
    return jsonify({"message": "Registered", "token": token, "user_id": user_id, "name": name}), 201


@app.route("/login", methods=["POST"])
def login():
    data  = request.get_json()
    email = data.get("email", "").strip().lower()
    pwd   = data.get("password", "")

    db = get_db()
    users_ref = db.collection('users')
    existing = users_ref.where('email', '==', email).get()
    
    if not existing:
        return jsonify({"error": "Invalid credentials"}), 401
    
    user_doc = existing[0]
    user = user_doc.to_dict()
    
    if not bcrypt.checkpw(pwd.encode(), user["password"].encode()):
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

@app.route("/users/<user_id>", methods=["GET"])
@token_required
def get_user(user_id, current_user_id):
    db = get_db()
    user_ref = db.collection('users').document(user_id)
    user_doc = user_ref.get()
    
    if not user_doc.exists:
        return jsonify({"error": "User not found"}), 404
        
    user = user_doc.to_dict()
    user.pop("password", None) # Do not return hash
    
    green_limit, orange_limit = calc_limits(user)
    return jsonify({**user, "green_limit": green_limit, "orange_limit": orange_limit})


@app.route("/users/<user_id>/limits", methods=["PUT"])
@token_required
def update_limits(user_id, current_user_id):
    data        = request.get_json()
    people      = max(1, int(data.get("people_count", 1)))
    base_green  = float(data.get("base_green_per_person",  100))
    base_orange = float(data.get("base_orange_per_person", 200))

    if base_green >= base_orange:
        return jsonify({"error": "Green limit per person must be less than Orange limit per person"}), 400

    db = get_db()
    user_ref = db.collection('users').document(user_id)
    
    user_ref.update({
        "people_count": people,
        "base_green_per_person": base_green,
        "base_orange_per_person": base_orange
    })

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

    db = get_db()
    new_tap_ref = db.collection('taps').document()
    tap_id = new_tap_ref.id
    
    new_tap_ref.set({
        "tap_id": tap_id,
        "user_id": user_id,
        "tap_name": tap_name,
        "location": location,
        "tap_status": "OFF",
        "current_usage": 0.0,
        "last_update": datetime.datetime.utcnow()
    })
    
    return jsonify({"message": "Tap added", "tap_id": tap_id}), 201


@app.route("/taps/<user_id>", methods=["GET"])
@token_required
def get_taps(user_id, current_user_id):
    db = get_db()
    taps_ref = db.collection('taps').where('user_id', '==', user_id).get()
    
    taps = []
    for t in taps_ref:
        tap = t.to_dict()
        taps.append({
            "tap_id": tap["tap_id"],
            "tap_name": tap.get("tap_name", ""),
            "location": tap.get("location", ""),
            "tap_status": tap.get("tap_status", "OFF"),
            "current_usage": tap.get("current_usage", 0.0),
            "last_update": tap.get("last_update")
        })
        
    taps.sort(key=lambda x: x["tap_id"])
    return jsonify(taps)


@app.route("/tap-on/<tap_id>", methods=["POST"])
@token_required
def tap_on(tap_id, current_user_id):
    db = get_db()
    db.collection('taps').document(tap_id).update({"tap_status": "ON"})
    return jsonify({"message": f"Tap {tap_id} turned ON"})


@app.route("/tap-off/<tap_id>", methods=["POST"])
@token_required
def tap_off(tap_id, current_user_id):
    db = get_db()
    db.collection('taps').document(tap_id).update({"tap_status": "OFF"})
    return jsonify({"message": f"Tap {tap_id} turned OFF"})


@app.route("/delete-tap/<tap_id>", methods=["DELETE"])
@token_required
def delete_tap(tap_id, current_user_id):
    db = get_db()
    db.collection('taps').document(tap_id).delete()
    return jsonify({"message": "Tap deleted"})

# ─────────────────────────────────────────────────────────────
# DASHBOARD endpoint
# ─────────────────────────────────────────────────────────────

@app.route("/dashboard/<user_id>", methods=["GET"])
@token_required
def dashboard(user_id, current_user_id):
    db = get_db()
    user_doc = db.collection('users').document(user_id).get()
    if not user_doc.exists:
        return jsonify({"error": "User not found"}), 404
        
    user = user_doc.to_dict()
    green_limit, orange_limit = calc_limits(user)

    today_str = str(datetime.date.today())
    yesterday_str = str(datetime.date.today() - datetime.timedelta(days=1))

    taps_ref = db.collection('taps').where('user_id', '==', user_id).get()
    
    today_total = 0.0
    tap_usage = []
    for t in taps_ref:
        tap = t.to_dict()
        usage = tap.get("current_usage", 0.0)
        today_total += usage
        tap_usage.append({
            "tap_id": tap["tap_id"],
            "tap_name": tap.get("tap_name", ""),
            "location": tap.get("location", ""),
            "tap_status": tap.get("tap_status", "OFF"),
            "usage_today": usage
        })
        
    tap_usage.sort(key=lambda x: x["tap_id"])

    sys_total_doc = db.collection('system_daily_totals').document(f"{user_id}_{yesterday_str}").get()
    yesterday_total = 0.0
    if sys_total_doc.exists:
        yesterday_total = sys_total_doc.to_dict().get("total_usage", 0.0)
    else:
        # Fallback to tap_daily_archive
        arch_ref = db.collection('tap_daily_archive').where('user_id', '==', user_id).where('archive_date', '==', yesterday_str).get()
        for a in arch_ref:
            yesterday_total += a.to_dict().get("usage_liters", 0.0)

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

@app.route("/forecast/<user_id>", methods=["GET"])
@token_required
def forecast(user_id, current_user_id):
    days = int(request.args.get("days", 30))
    db = get_db()

    cutoff_date = datetime.date.today() - datetime.timedelta(days=days)
    sys_totals = db.collection('system_daily_totals').where('user_id', '==', user_id).get()

    data_points = []
    for doc in sys_totals:
        data = doc.to_dict()
        u_date_str = data.get("usage_date")
        if not u_date_str: continue
        u_date = datetime.datetime.strptime(u_date_str, "%Y-%m-%d").date()
        if cutoff_date <= u_date <= datetime.date.today():
            data_points.append({
                "date": u_date,
                "usage": data.get("total_usage", 0.0)
            })

    data_points.sort(key=lambda x: x["date"])

    if len(data_points) < 3:
        return jsonify({"error": "Not enough historical data to generate a reliable forecast. Please wait a few days.", "points": []}), 400

    user_doc = db.collection('users').document(user_id).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    green_limit, orange_limit = calc_limits(user_data)
    people_count = user_data.get("people_count", 1) or 1

    # ── ML-powered forecast ─────────────────────────────────
    dates  = [p["date"] for p in data_points]
    usages = [p["usage"] for p in data_points]

    forecaster = GradientBoostedForecaster()
    forecaster.train(dates, usages, people_count)
    predictions = forecaster.predict_next_days(dates, usages, people_count, n_days=7)

    # Breach detection
    projected_green_breach = False
    projected_orange_breach = False
    for p in predictions:
        if p["usage"] > orange_limit:
            projected_orange_breach = True
        elif p["usage"] > green_limit:
            projected_green_breach = True

    historical = [{
        "date": str(p["date"]),
        "usage": round(p["usage"], 2),
        "is_prediction": False
    } for p in data_points]

    if projected_orange_breach:
        warning = "CRITICAL: You are projected to exceed your Orange Limit in the next 7 days! Take immediate action."
    elif projected_green_breach:
        warning = "WARNING: You are projected to exceed your Green Limit in the next 7 days. Consider reducing usage."
    else:
        warning = "Great job! You are projected to stay within your limits for the next 7 days."

    return jsonify({
        "historical": historical,
        "predictions": predictions,
        "warning": warning,
        "green_limit": green_limit,
        "orange_limit": orange_limit,
        "model_type": forecaster.model_type,
        "confidence": round(forecaster.r2, 3) if forecaster.r2 is not None else 0.0,
    })


@app.route("/tap-limits/<user_id>", methods=["GET"])
@token_required
def tap_limits(user_id, current_user_id):
    db = get_db()

    user_doc = db.collection('users').document(user_id).get()
    if not user_doc.exists:
        return jsonify({"error": "User not found"}), 404
    user_data = user_doc.to_dict()
    green_limit, orange_limit = calc_limits(user_data)
    people_count = user_data.get("people_count", 1) or 1

    # Fetch live taps
    taps_ref = db.collection('taps').where('user_id', '==', user_id).get()
    taps = []
    for t in taps_ref:
        d = t.to_dict()
        taps.append({
            "tap_id": d.get("tap_id", t.id),
            "tap_name": d.get("tap_name", ""),
            "location": d.get("location", ""),
            "current_usage": d.get("current_usage", 0.0),
        })

    # Fetch archive (last 30 days)
    cutoff_str = str(datetime.date.today() - datetime.timedelta(days=30))
    arch_ref = db.collection('tap_daily_archive').where('user_id', '==', user_id).get()
    archive_docs = []
    for a in arch_ref:
        doc = a.to_dict()
        if doc.get("archive_date", "") >= cutoff_str:
            archive_docs.append(doc)

    predictor = TapUsagePredictor()
    result = predictor.predict_tap_limits(
        taps, archive_docs, green_limit, orange_limit, people_count
    )
    return jsonify(result)

@app.route("/usage-timeseries/<user_id>", methods=["GET"])
@token_required
def usage_timeseries(user_id, current_user_id):
    hours = int(request.args.get("hours", 24))

    if hours <= 6:
        bucket_mins = 5
    elif hours <= 24:
        bucket_mins = 15
    elif hours <= 48:
        bucket_mins = 30
    else:
        bucket_mins = 60

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)
    
    db = get_db()
    # Fetch all for user and filter in Python to avoid needing composite index
    ts_ref = db.collection('tap_usage_timeseries').where('user_id', '==', user_id).get()
    
    buckets = {}
    for t in ts_ref:
        doc = t.to_dict()
        rec_time = doc.get("recorded_at")
        if not rec_time: continue
        # Handle Firestore Timestamp
        if hasattr(rec_time, 'timestamp'):
            dt = datetime.datetime.fromtimestamp(rec_time.timestamp())
        else:
            dt = rec_time # already datetime
            
        if dt >= cutoff:
            # Create bucket string
            bucket_dt = dt - datetime.timedelta(minutes=dt.minute % bucket_mins, seconds=dt.second, microseconds=dt.microsecond)
            bucket_str = bucket_dt.strftime("%H:%M")
            
            if bucket_str not in buckets:
                buckets[bucket_str] = {"total": 0.0, "sort_time": bucket_dt}
            buckets[bucket_str]["total"] += doc.get("usage_liters", 0.0)
            
    # Sort and format
    sorted_buckets = sorted(buckets.items(), key=lambda x: x[1]["sort_time"])
    
    return jsonify({
        "bucket_mins": bucket_mins,
        "data": [{"time_bucket": k, "total_liters": round(v["total"], 2)} for k, v in sorted_buckets],
    })


@app.route("/daily-usage/<user_id>", methods=["GET"])
@token_required
def daily_usage(user_id, current_user_id):
    days = int(request.args.get("days", 30))

    db = get_db()
    
    cutoff_date = datetime.date.today() - datetime.timedelta(days=days)
    
    sys_totals = db.collection('system_daily_totals').where('user_id', '==', user_id).get()
    
    archived = []
    for doc in sys_totals:
        data = doc.to_dict()
        u_date_str = data.get("usage_date")
        if not u_date_str: continue
        
        u_date = datetime.datetime.strptime(u_date_str, "%Y-%m-%d").date()
        if cutoff_date <= u_date < datetime.date.today():
            archived.append({
                "date": u_date_str,
                "total_usage": data.get("total_usage", 0.0),
                "color_status": data.get("color_status", "green"),
                "is_live": False
            })
            
    archived.sort(key=lambda x: x["date"])

    taps = db.collection('taps').where('user_id', '==', user_id).get()
    today_total = sum(t.to_dict().get("current_usage", 0.0) for t in taps)

    user_doc = db.collection('users').document(user_id).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    green_limit, orange_limit = calc_limits(user_data)
    today_color = get_color(today_total, green_limit, orange_limit)

    result = archived + [{
        "date": str(datetime.date.today()),
        "total_usage": round(today_total, 2),
        "color_status": today_color,
        "is_live": True,
    }]

    return jsonify(result)


@app.route("/hourly-pattern/<user_id>", methods=["GET"])
@token_required
def hourly_pattern(user_id, current_user_id):
    days = int(request.args.get("days", 30))
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    
    db = get_db()
    ts_ref = db.collection('tap_usage_timeseries').where('user_id', '==', user_id).get()
    
    hour_stats = {h: {"total": 0.0, "days": set()} for h in range(24)}
    
    for t in ts_ref:
        doc = t.to_dict()
        rec_time = doc.get("recorded_at")
        if not rec_time: continue
        
        if hasattr(rec_time, 'timestamp'):
            dt = datetime.datetime.fromtimestamp(rec_time.timestamp())
        else:
            dt = rec_time
            
        if dt >= cutoff:
            h = dt.hour
            d_str = dt.strftime("%Y-%m-%d")
            hour_stats[h]["total"] += doc.get("usage_liters", 0.0)
            hour_stats[h]["days"].add(d_str)
            
    result = []
    for h in range(24):
        total = hour_stats[h]["total"]
        days_ct = max(len(hour_stats[h]["days"]), 1)
        avg = round(total / days_ct, 2)
        result.append({
            "hour": h,
            "label": f"{h:02d}:00",
            "total_liters": round(total, 2),
            "avg_liters": avg,
        })
        
    return jsonify(result)

@app.route("/today-hourly/<user_id>", methods=["GET"])
@token_required
def today_hourly(user_id, current_user_id):
    today_str = str(datetime.date.today())
    
    db = get_db()
    ts_ref = db.collection('tap_usage_timeseries').where('user_id', '==', user_id).get()
    
    hour_totals = {h: 0.0 for h in range(24)}
    
    for t in ts_ref:
        doc = t.to_dict()
        rec_time = doc.get("recorded_at")
        if not rec_time: continue
        
        if hasattr(rec_time, 'timestamp'):
            dt = datetime.datetime.fromtimestamp(rec_time.timestamp())
        else:
            dt = rec_time
            
        if dt.strftime("%Y-%m-%d") == today_str:
            hour_totals[dt.hour] += doc.get("usage_liters", 0.0)
            
    result = [
        { "hour": h, "label": f"{h:02d}:00", "liters": round(hour_totals[h], 2) }
        for h in range(24)
    ]
    return jsonify(result)


@app.route("/usage-by-tap/<user_id>", methods=["GET"])
@token_required
def usage_by_tap(user_id, current_user_id):
    days = int(request.args.get("days", 7))
    cutoff_date_str = str(datetime.date.today() - datetime.timedelta(days=days))
    today_str = str(datetime.date.today())
    
    db = get_db()
    
    # Live taps
    taps_ref = db.collection('taps').where('user_id', '==', user_id).get()
    tap_info = {}
    for t in taps_ref:
        data = t.to_dict()
        tap_info[data["tap_id"]] = {
            "tap_name": data.get("tap_name", ""),
            "location": data.get("location", ""),
            "total_usage": data.get("current_usage", 0.0)
        }
        
    # Archived
    arch_ref = db.collection('tap_daily_archive').where('user_id', '==', user_id).get()
    for a in arch_ref:
        doc = a.to_dict()
        u_date_str = doc.get("archive_date", "")
        if cutoff_date_str <= u_date_str < today_str:
            t_id = doc.get("tap_id")
            if t_id in tap_info:
                tap_info[t_id]["total_usage"] += doc.get("usage_liters", 0.0)
                
    result = []
    for t_id, info in tap_info.items():
        result.append({
            "tap_name": info["tap_name"],
            "location": info["location"],
            "total_usage": round(info["total_usage"], 2)
        })
        
    result.sort(key=lambda x: x["total_usage"], reverse=True)
    return jsonify(result)


@app.route("/export-csv/<user_id>", methods=["GET"])
def export_csv(user_id):
    token = request.args.get("token") or request.headers.get("Authorization","").replace("Bearer ","")
    if not token:
        return jsonify({"error": "Token missing"}), 401
    try:
        jwt.decode(token, Config.JWT_SECRET_KEY, algorithms=["HS256"])
    except Exception:
        return jsonify({"error": "Invalid or expired token"}), 401

    days = int(request.args.get("days", 30))
    cutoff_date_str = str(datetime.date.today() - datetime.timedelta(days=days))
    today_str = str(datetime.date.today())
    
    db = get_db()
    
    taps_ref = db.collection('taps').where('user_id', '==', user_id).get()
    tap_names = {t.id: t.to_dict() for t in taps_ref}
    
    arch_ref = db.collection('tap_daily_archive').where('user_id', '==', user_id).get()
    
    all_rows = []
    for a in arch_ref:
        doc = a.to_dict()
        u_date_str = doc.get("archive_date", "")
        if u_date_str >= cutoff_date_str:
            t_id = doc.get("tap_id")
            t_info = tap_names.get(t_id, {})
            all_rows.append({
                "archive_date": u_date_str,
                "tap_name": t_info.get("tap_name", ""),
                "location": t_info.get("location", ""),
                "usage_liters": round(doc.get("usage_liters", 0.0), 3)
            })
            
    # Add live rows
    for t_id, t_info in tap_names.items():
        all_rows.append({
            "archive_date": f"{today_str} (live)",
            "tap_name": t_info.get("tap_name", ""),
            "location": t_info.get("location", ""),
            "usage_liters": round(t_info.get("current_usage", 0.0), 3)
        })
        
    all_rows.sort(key=lambda x: (x["archive_date"], x["tap_name"]), reverse=True)

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
# BACKGROUND & ARCHIVE HELPERS
# ─────────────────────────────────────────────────────────────

def _do_archive_for_date(archive_date_obj):
    db = get_db()
    archive_str = str(archive_date_obj)
    
    taps_ref = db.collection('taps').get()
    users_totals = {}
    
    for t in taps_ref:
        tap = t.to_dict()
        usage = tap.get("current_usage", 0.0)
        u_id = tap.get("user_id")
        
        if u_id not in users_totals:
            users_totals[u_id] = 0.0
        users_totals[u_id] += usage
        
        arch_id = f"{tap['tap_id']}_{archive_str}"
        db.collection('tap_daily_archive').document(arch_id).set({
            "tap_id": tap["tap_id"],
            "user_id": u_id,
            "usage_liters": usage,
            "archive_date": archive_str
        })
        
    for u_id, total in users_totals.items():
        user_doc = db.collection('users').document(u_id).get()
        user_data = user_doc.to_dict() if user_doc.exists else {}
        g_lim, o_lim = calc_limits(user_data)
        color = get_color(total, g_lim, o_lim)
        
        sys_id = f"{u_id}_{archive_str}"
        db.collection('system_daily_totals').document(sys_id).set({
            "user_id": u_id,
            "total_usage": total,
            "color_status": color,
            "usage_date": archive_str
        })

def _reset_running_totals():
    db = get_db()
    taps_ref = db.collection('taps').get()
    now = datetime.datetime.utcnow()
    for t in taps_ref:
        t.reference.update({
            "current_usage": 0.0,
            "last_update": now
        })

@app.route("/archive-daily-data", methods=["POST"])
def archive_daily_data():
    archive_date = datetime.date.today()
    _do_archive_for_date(archive_date)
    _reset_running_totals()
    return jsonify({"message": "Archive complete", "date": str(archive_date)})


@app.route("/flow-status/<user_id>", methods=["GET"])
@token_required
def flow_status(user_id, current_user_id):
    try:
        db = get_db()
        taps_ref = db.collection('taps').where('user_id', '==', user_id).get()
        today_total = sum(t.to_dict().get("current_usage", 0.0) for t in taps_ref)
        
        user_doc = db.collection('users').document(user_id).get()
        user_data = user_doc.to_dict() if user_doc.exists else {}
        g_lim, o_lim = calc_limits(user_data)
        
        throttled = today_total >= g_lim
        return jsonify({
            "today_total":  round(today_total, 2),
            "green_limit":  g_lim,
            "orange_limit": o_lim,
            "throttled":    throttled,
            "speed_mode":   "throttled (30%)" if throttled else "normal (100%)",
            "message":      "⚠️ AI throttle active — flow reduced to 30% (green limit exceeded)" if throttled
                            else "✅ Normal flow — within green limit",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/setup/<user_id>", methods=["GET"])
@token_required
def get_setup(user_id, current_user_id):
    db = get_db()
    taps_ref = db.collection('taps').where('user_id', '==', user_id).get()
    taps = [{"tap_id": t.id, "tap_name": t.to_dict().get("tap_name"), "location": t.to_dict().get("location"), "tap_status": t.to_dict().get("tap_status")} for t in taps_ref]
    
    user_doc = db.collection('users').document(user_id).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    g_lim, o_lim = calc_limits(user_data)
    
    return jsonify({"taps": taps, **user_data, "green_limit": g_lim, "orange_limit": o_lim})

# ─────────────────────────────────────────────────────────────
# BACKGROUND THREADS — scheduler + simulator
# ─────────────────────────────────────────────────────────────

_threads_started = False

def _scheduler_thread():
    import schedule as sched_lib
    def _midnight_archive():
        try:
            archive_date = datetime.date.today()
            _do_archive_for_date(archive_date)
            _reset_running_totals()
        except Exception as exc:
            print(f"[SCHEDULER] Error: {exc}")
    sched_lib.every().day.at("00:00").do(_midnight_archive)
    while True:
        sched_lib.run_pending()
        _time.sleep(30)


def _simulate_tick():
    today = datetime.date.today()
    db = get_db()
    
    # Rollover check
    taps_ref = db.collection('taps').get()
    stale_dates = set()
    for t in taps_ref:
        data = t.to_dict()
        last_update = data.get("last_update")
        if last_update:
            if hasattr(last_update, 'timestamp'):
                dt = datetime.datetime.fromtimestamp(last_update.timestamp()).date()
            else:
                dt = last_update.date() if hasattr(last_update, 'date') else last_update
                
            if dt < today and data.get("current_usage", 0) > 0:
                stale_dates.add(dt)
                
    for past_date in sorted(stale_dates):
        _do_archive_for_date(past_date)
    if stale_dates:
        _reset_running_totals()

    on_taps = db.collection('taps').where('tap_status', '==', 'ON').get()
    if not on_taps:
        return {"message": "Simulated 0 tap(s) — no taps are ON", "taps_on": 0, "speed_mode": "normal"}

    user_totals = {}
    user_limits = {}
    for t in on_taps:
        uid = t.to_dict().get("user_id")
        if uid not in user_totals:
            u_taps = db.collection('taps').where('user_id', '==', uid).get()
            user_totals[uid] = sum(ut.to_dict().get("current_usage", 0.0) for ut in u_taps)
            u_doc = db.collection('users').document(uid).get()
            user_limits[uid] = calc_limits(u_doc.to_dict() if u_doc.exists else {})

    ticked = 0
    throttled = 0
    now = datetime.datetime.utcnow()
    
    batch = db.batch()
    for t in on_taps:
        data = t.to_dict()
        uid = data.get("user_id")
        tap_id = data.get("tap_id")
        
        g_lim, _ = user_limits.get(uid, (100.0, 200.0))
        if user_totals.get(uid, 0) >= g_lim:
            amount = round(random.uniform(Config.SIMULATE_MIN_LITERS * 0.3, Config.SIMULATE_MAX_LITERS * 0.3), 3)
            throttled += 1
        else:
            amount = round(random.uniform(Config.SIMULATE_MIN_LITERS, Config.SIMULATE_MAX_LITERS), 3)
        ticked += 1
        
        # Timeseries
        ts_ref = db.collection('tap_usage_timeseries').document()
        batch.set(ts_ref, {
            "tap_id": tap_id,
            "user_id": uid,
            "usage_liters": amount,
            "recorded_at": now
        })
        
        # Update running
        new_usage = data.get("current_usage", 0.0) + amount
        batch.update(t.reference, {
            "current_usage": new_usage,
            "last_update": now
        })
        
    batch.commit()

    return {
        "message": f"Simulated {ticked} tap(s)",
        "taps_on": ticked,
        "speed_mode": "throttled" if throttled > 0 else "normal",
        "throttled": throttled,
    }


@app.route("/simulate-usage", methods=["POST"])
def simulate_usage():
    result = _simulate_tick()
    return jsonify(result)


def _simulator_thread():
    interval = Config.SIMULATE_INTERVAL_SECONDS
    _time.sleep(2)
    while True:
        try:
            _simulate_tick()
        except Exception as exc:
            pass
        _time.sleep(interval)


def start_background_threads():
    global _threads_started
    if _threads_started: return
    _threads_started = True

    t1 = threading.Thread(target=_scheduler_thread, daemon=True, name="scheduler")
    t1.start()

    if Config.ENABLE_SIMULATOR:
        t2 = threading.Thread(target=_simulator_thread, daemon=True, name="simulator")
        t2.start()

def _run_startup():
    start_background_threads()

_run_startup()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port, use_reloader=False)
