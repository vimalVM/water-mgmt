# 💧 AquaTrack – Smart Water Management & Usage Analytics System

> Final Year Project | Full Stack | React · Flask · MySQL

---

## 📐 System Architecture

```
[React Dashboard]
      ↑  (Axios REST)
      |
[Flask API  :5000]  ←── Background Threads:
      |                    • Simulator  (every 60s — adds usage to ON taps)
      |                    • Scheduler  (midnight  — archives daily data)
      ↓
[MySQL Database]
  users · taps · tap_usage_running · tap_usage_timeseries
  tap_daily_archive · system_daily_totals
```

---

## 🗂️ Project Structure

```
water-mgmt/
├── render.yaml             ← Render deployment blueprint
├── backend/
│   ├── app.py              ← Flask REST API + scheduler + simulator (all-in-one)
│   ├── config.py           ← Config from environment variables
│   ├── .env                ← Local dev secrets (git-ignored)
│   ├── .env.example        ← Template for env vars (safe to commit)
│   ├── Procfile            ← Render/Heroku start command
│   ├── schema.sql          ← Full MySQL schema
│   └── requirements.txt    ← Python dependencies
│
└── frontend/
    ├── .env                ← Local dev config (REACT_APP_API_URL)
    ├── public/index.html
    ├── package.json
    └── src/
        ├── App.jsx                 ← Router & private routes
        ├── index.js                ← Entry point
        ├── api/index.js            ← All Axios API calls
        ├── context/AuthContext.jsx ← JWT auth context
        ├── components/
        │   ├── Layout.jsx          ← Sidebar navigation
        │   └── WaterTank.jsx       ← SVG animated beaker
        └── pages/
            ├── Login.jsx
            ├── Register.jsx
            ├── Dashboard.jsx       ← Main analytics dashboard
            ├── ManageConfig.jsx    ← Tap management + system setup
            └── Reports.jsx         ← Charts + CSV export
```

---

## ⚙️ Setup & Installation

### Step 1 – MySQL Database

1. Open **MySQL Workbench**
2. Connect to your local MySQL server
3. Open and run `backend/schema.sql`
   - Creates database `water_mgmt`
   - Creates all 6 tables with proper foreign keys

### Step 2 – Backend Environment Variables

```bash
cd backend

# Copy the template and fill in your values
cp .env.example .env

# Edit .env → set your MySQL password and a strong JWT secret
```

### Step 3 – Backend (Flask)

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the API server (includes scheduler + simulator automatically)
python app.py
# → Runs on http://localhost:5000
# → Simulator ticks every 60s in background
# → Scheduler runs midnight archive in background
```

> **Note:** You only need ONE terminal for the entire backend now!

### Step 4 – Frontend (React)

```bash
cd frontend

npm install
npm start
# → Opens http://localhost:3000
```

---

## 🔑 First-Time Usage

1. Open `http://localhost:3000`
2. Click **Register** → create your account
3. Go to **Manage** → add your taps (Bathroom, Kitchen, Toilet…)
4. Configure your daily green/orange limits
5. Toggle taps ON
6. Watch the **Dashboard** auto-refresh every 60 seconds with live data!

---

## 🚀 Deploying on Render

### Prerequisites
- Push your code to a GitHub repository
- Sign up at [render.com](https://render.com)
- Set up a MySQL database using [Railway](https://railway.app), [PlanetScale](https://planetscale.com), or [Aiven](https://aiven.io)

### Option A: Automatic (Blueprint)

1. In Render Dashboard → **New** → **Blueprint**
2. Connect your GitHub repo
3. Render reads `render.yaml` and creates both services automatically
4. Set environment variables in each service's settings:

**Backend (`aquatrack-api`)**:
| Variable | Value |
|---|---|
| `MYSQL_HOST` | your-mysql-host |
| `MYSQL_USER` | your-mysql-user |
| `MYSQL_PASSWORD` | your-mysql-password |
| `MYSQL_DB` | your-mysql-database |
| `MYSQL_PORT` | your-mysql-port |
| `JWT_SECRET_KEY` | (auto-generated) |
| `CORS_ORIGINS` | `https://aquatrack-frontend.onrender.com` |
| `ENABLE_SIMULATOR` | `true` or `false` |

**Frontend (`aquatrack-frontend`)**:
| Variable | Value |
|---|---|
| `REACT_APP_API_URL` | `https://aquatrack-api.onrender.com` |

### Option B: Manual Setup

**Backend:**
1. **New** → **Web Service** → Connect GitHub repo
2. Root Directory: `backend`
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4`
5. Add environment variables (see table above)

**Frontend:**
1. **New** → **Static Site** → Connect GitHub repo
2. Root Directory: `frontend`
3. Build Command: `npm install && npm run build`
4. Publish Directory: `build`
5. Add rewrite rule: `/*` → `/index.html` (for React Router)
6. Set `REACT_APP_API_URL` env var

---

## 🌐 API Reference

| Method | Endpoint                      | Auth | Description                      |
|--------|-------------------------------|------|----------------------------------|
| POST   | `/register`                   | ✗    | Register new user                |
| POST   | `/login`                      | ✗    | Login, returns JWT token         |
| GET    | `/users/{user_id}`            | ✓    | Get user profile                 |
| PUT    | `/users/{user_id}/limits`     | ✓    | Update green/orange limits       |
| POST   | `/add-tap`                    | ✓    | Add a new tap                    |
| GET    | `/taps/{user_id}`             | ✓    | Get all taps with running usage  |
| DELETE | `/delete-tap/{tap_id}`        | ✓    | Delete a tap                     |
| POST   | `/tap-on/{tap_id}`            | ✓    | Turn tap ON                      |
| POST   | `/tap-off/{tap_id}`           | ✓    | Turn tap OFF                     |
| GET    | `/dashboard/{user_id}`        | ✓    | Full dashboard data              |
| GET    | `/usage-timeseries/{user_id}` | ✓    | Time-series data (last N hours)  |
| GET    | `/daily-usage/{user_id}`      | ✓    | Daily archived totals            |
| GET    | `/usage-by-tap/{user_id}`     | ✓    | Per-tap breakdown                |
| GET    | `/export-csv/{user_id}`       | ✓    | Download usage CSV               |
| POST   | `/simulate-usage`             | ✗    | Trigger simulator tick           |
| POST   | `/archive-daily-data`         | ✗    | Trigger midnight archive         |
| GET    | `/setup/{user_id}`            | ✓    | Setup page data                  |
| GET    | `/flow-status/{user_id}`      | ✓    | AI throttle status               |

---

## 🗄️ Database Schema Summary

| Table                  | Purpose                                      |
|------------------------|----------------------------------------------|
| `users`                | Accounts with green/orange limits            |
| `taps`                 | Tap definitions (name, location, ON/OFF)     |
| `tap_usage_running`    | Today's running total per tap (reset daily)  |
| `tap_usage_timeseries` | Every simulator tick (detailed history)      |
| `tap_daily_archive`    | Archived daily totals per tap                |
| `system_daily_totals`  | Aggregated daily total + color status / user |

---

## 🎨 Color Status Logic

| Status     | Condition                          | Meaning         |
|------------|------------------------------------|--------------------|
| 🟢 Green   | `usage < green_limit`              | Safe usage      |
| 🟠 Orange  | `green_limit ≤ usage < orange_limit` | Moderate usage  |
| 🔴 Red     | `usage ≥ orange_limit`             | Critical usage  |

Default limits: Green = 100 L/day, Orange = 200 L/day

---

## 🔮 Future Improvements

- **IoT Integration** – Replace simulator with real sensor MQTT feed (ESP32/Arduino)
- **Push Notifications** – Email/SMS alerts when orange/red threshold crossed
- **Mobile App** – React Native companion app
- **Leak Detection** – Anomaly detection if tap ON for too long with no user
- **Multi-house** – Support for multiple properties per user
- **Bill Estimation** – Calculate estimated water bill from usage data
- **Weather Integration** – Correlate usage with temperature/season
- **AI Recommendations** – ML model to suggest usage reduction tips
- **Two-Factor Auth** – Enhanced security for production
- **Docker Deployment** – Containerise all services with docker-compose

---

## 👨‍💻 Tech Stack

| Layer      | Technology                  |
|------------|--------------------------------|
| Frontend   | React 18, React Router 6, Recharts, Axios |
| Styling    | Inline CSS (dark theme), Google Fonts DM Sans |
| Backend    | Python 3.10+, Flask 3, Flask-CORS, Gunicorn |
| Auth       | JWT (PyJWT), bcrypt          |
| Database   | MySQL 8, mysql-connector-python |
| Scheduler  | `schedule` library (background thread) |
| Simulator  | Background thread with `time.sleep` |
| Hosting    | Render (Web Service + Static Site) |

---

_Built with 💧 for Final Year Project_
