"""
Smart Water Management – Configuration
───────────────────────────────────────
All secrets are loaded from environment variables.
For local development, create a `.env` file in this directory.
On Render / production, set them in the dashboard.
"""

from dotenv import load_dotenv
import os

load_dotenv()  # reads backend/.env if it exists


class Config:
    # ── MySQL ──────────────────────────────────────────────────
    MYSQL_HOST     = os.getenv("MYSQL_HOST", "localhost")
    MYSQL_USER     = os.getenv("MYSQL_USER", "root")
    MYSQL_PASSWORD = os.environ["MYSQL_PASSWORD"]           # REQUIRED
    MYSQL_DB       = os.getenv("MYSQL_DB", "water_mgmt")
    MYSQL_PORT     = int(os.getenv("MYSQL_PORT", 3306))

    # ── JWT ───────────────────────────────────────────────────
    JWT_SECRET_KEY   = os.environ["JWT_SECRET_KEY"]         # REQUIRED
    JWT_EXPIRY_HOURS = 24

    # ── CORS ──────────────────────────────────────────────────
    CORS_ORIGINS = [
        o.strip()
        for o in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if o.strip()
    ]

    # ── Simulator ────────────────────────────────────────────
    ENABLE_SIMULATOR          = os.getenv("ENABLE_SIMULATOR", "true").lower() == "true"
    SIMULATE_INTERVAL_SECONDS = int(os.getenv("SIMULATE_INTERVAL_SECONDS", 60))
    SIMULATE_MIN_LITERS       = float(os.getenv("SIMULATE_MIN_LITERS", 0.5))
    SIMULATE_MAX_LITERS       = float(os.getenv("SIMULATE_MAX_LITERS", 3.0))
