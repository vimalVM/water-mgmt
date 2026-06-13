"""
Smart Water Management – ML Models
───────────────────────────────────
1. GradientBoostedForecaster  – replaces linear regression for /forecast
2. TapUsagePredictor          – per-tap usage prediction for /tap-limits
"""

import datetime
import numpy as np

try:
    import lightgbm as lgb
    from sklearn.metrics import r2_score
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False


# ─────────────────────────────────────────────────────────────
# 1. Gradient-Boosted Forecaster
# ─────────────────────────────────────────────────────────────

class GradientBoostedForecaster:
    """
    Trains a LightGBM regressor on daily usage data with engineered
    features to predict the next 7 days.  Falls back to simple linear
    regression when data is insufficient (< 7 points) or when
    lightgbm is not installed.
    """

    MIN_POINTS_FOR_LGBM = 7   # need at least 7 days for meaningful features

    def __init__(self):
        self.model = None
        self.r2 = None
        self.model_type = None

    # ── feature engineering ─────────────────────────────────
    @staticmethod
    def _build_features(dates, usages, people_count):
        """
        Given parallel lists of dates (datetime.date) and usages (float),
        return a 2-D numpy array of features per row.
        Features:
          0  day_index        – ordinal position (0, 1, 2, …)
          1  day_of_week      – 0=Mon … 6=Sun
          2  is_weekend       – 1 if Sat/Sun
          3  rolling_avg_3d   – mean of previous 3 days (0 if not enough)
          4  rolling_avg_7d   – mean of previous 7 days (0 if not enough)
          5  lag_1d           – usage 1 day ago (0 if N/A)
          6  lag_7d           – usage 7 days ago (0 if N/A)
          7  people_count     – household size (constant)
        """
        n = len(dates)
        X = np.zeros((n, 8), dtype=np.float64)
        for i in range(n):
            X[i, 0] = i                                     # day_index
            X[i, 1] = dates[i].weekday()                    # day_of_week
            X[i, 2] = 1.0 if dates[i].weekday() >= 5 else 0.0  # is_weekend

            # rolling averages
            if i >= 3:
                X[i, 3] = np.mean(usages[i-3:i])
            if i >= 7:
                X[i, 4] = np.mean(usages[i-7:i])

            # lags
            if i >= 1:
                X[i, 5] = usages[i-1]
            if i >= 7:
                X[i, 6] = usages[i-7]

            X[i, 7] = people_count
        return X

    # ── training ────────────────────────────────────────────
    def train(self, dates, usages, people_count):
        """
        Train on historical data.  Returns self.
        dates:   list[datetime.date]  sorted ascending
        usages:  list[float]          parallel to dates
        """
        n = len(dates)

        # ── fallback to linear regression ───────────────────
        if not ML_AVAILABLE or n < self.MIN_POINTS_FOR_LGBM:
            self.model_type = "linear_regression_fallback"
            self._train_linear(dates, usages)
            return self

        # ── LightGBM path ──────────────────────────────────
        self.model_type = "lightgbm"
        X = self._build_features(dates, usages, people_count)
        y = np.array(usages, dtype=np.float64)

        params = {
            "objective": "regression",
            "metric": "rmse",
            "learning_rate": 0.1,
            "num_leaves": 15,
            "min_child_samples": 3,
            "n_estimators": 100,
            "verbosity": -1,
            "force_col_wise": True,
        }
        self.model = lgb.LGBMRegressor(**params)
        self.model.fit(X, y)

        # R² on training data as a rough confidence metric
        preds = self.model.predict(X)
        self.r2 = float(r2_score(y, preds))
        return self

    def _train_linear(self, dates, usages):
        """Simple y = mx + b fallback."""
        n = len(dates)
        if n < 2:
            self._lin_m = 0.0
            self._lin_b = usages[0] if usages else 0.0
            self.r2 = 0.0
            return
        start = dates[0]
        X = [(d - start).days for d in dates]
        Y = list(usages)
        N = len(X)
        sx  = sum(X)
        sy  = sum(Y)
        sxy = sum(x * y for x, y in zip(X, Y))
        sx2 = sum(x ** 2 for x in X)
        denom = N * sx2 - sx ** 2
        if denom == 0:
            self._lin_m = 0.0
        else:
            self._lin_m = (N * sxy - sx * sy) / denom
        self._lin_b = (sy - self._lin_m * sx) / N
        self._lin_start = start

        # R² for linear
        y_mean = sy / N
        ss_res = sum((y - (self._lin_m * x + self._lin_b)) ** 2 for x, y in zip(X, Y))
        ss_tot = sum((y - y_mean) ** 2 for y in Y)
        self.r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    # ── prediction ──────────────────────────────────────────
    def predict_next_days(self, dates, usages, people_count, n_days=7):
        """
        Predict the next n_days after the last date.
        Returns list of {"date": str, "usage": float, "is_prediction": True}
        """
        if self.model_type == "linear_regression_fallback":
            return self._predict_linear(dates, n_days)

        # Iterative prediction: predict day-by-day so lag features can update
        last_date = dates[-1]
        all_dates = list(dates)
        all_usages = list(usages)
        predictions = []

        for i in range(1, n_days + 1):
            pred_date = last_date + datetime.timedelta(days=i)
            all_dates.append(pred_date)
            all_usages.append(0.0)  # placeholder

            X = self._build_features(all_dates, all_usages, people_count)
            row = X[-1:, :]
            pred_val = float(self.model.predict(row)[0])
            pred_val = max(0.0, pred_val)

            all_usages[-1] = pred_val  # update for next iteration's lag

            predictions.append({
                "date": str(pred_date),
                "usage": round(pred_val, 2),
                "is_prediction": True,
            })

        return predictions

    def _predict_linear(self, dates, n_days):
        last_date = dates[-1]
        start = getattr(self, "_lin_start", dates[0])
        last_x = (last_date - start).days
        predictions = []
        for i in range(1, n_days + 1):
            pred_date = last_date + datetime.timedelta(days=i)
            pred_x = last_x + i
            pred_y = max(0.0, self._lin_m * pred_x + self._lin_b)
            predictions.append({
                "date": str(pred_date),
                "usage": round(pred_y, 2),
                "is_prediction": True,
            })
        return predictions


# ─────────────────────────────────────────────────────────────
# 2. Per-Tap Usage Predictor
# ─────────────────────────────────────────────────────────────

# Canonical location categories for one-hot encoding
_LOCATION_CATS = ["bathroom", "kitchen", "toilet", "garden",
                  "living room", "balcony", "laundry", "general"]


class TapUsagePredictor:
    """
    Learns per-tap usage patterns from tap_daily_archive and live tap
    data.  Outputs recommended per-tap green/orange limits as
    proportional shares of the household totals.

    Falls back to a simple proportional split when ML is unavailable
    or data is insufficient.
    """

    MIN_ARCHIVE_DAYS = 3  # minimum distinct days of archive data

    def predict_tap_limits(self, taps, archive_docs, household_green,
                           household_orange, people_count):
        """
        Parameters
        ----------
        taps : list[dict]
            Live tap documents (tap_id, tap_name, location, current_usage).
        archive_docs : list[dict]
            tap_daily_archive documents (tap_id, usage_liters, archive_date).
        household_green : float
        household_orange : float
        people_count : int

        Returns
        -------
        dict with keys: model_type, tap_limits, household_green, household_orange
        """
        if not taps:
            return {
                "model_type": "no_taps",
                "tap_limits": [],
                "household_green": household_green,
                "household_orange": household_orange,
            }

        # Build per-tap daily usage matrix
        tap_ids = [t["tap_id"] for t in taps]
        tap_meta = {t["tap_id"]: t for t in taps}

        # Aggregate archive by (tap_id, date)
        tap_date_usage = {}  # tap_id -> {date_str -> usage}
        all_dates = set()
        for doc in archive_docs:
            tid = doc.get("tap_id")
            d_str = doc.get("archive_date", "")
            u = doc.get("usage_liters", 0.0)
            if tid in tap_meta and d_str:
                tap_date_usage.setdefault(tid, {})[d_str] = \
                    tap_date_usage.get(tid, {}).get(d_str, 0.0) + u
                all_dates.add(d_str)

        distinct_days = len(all_dates)
        use_ml = ML_AVAILABLE and distinct_days >= self.MIN_ARCHIVE_DAYS

        if use_ml:
            return self._predict_ml(
                tap_ids, tap_meta, tap_date_usage, sorted(all_dates),
                household_green, household_orange, people_count,
            )
        else:
            return self._predict_proportional(
                tap_ids, tap_meta, tap_date_usage, all_dates,
                household_green, household_orange,
            )

    # ── ML path ─────────────────────────────────────────────
    def _predict_ml(self, tap_ids, tap_meta, tap_date_usage, sorted_dates,
                    household_green, household_orange, people_count):
        """
        Train a LightGBM model per tap to predict its daily usage.
        Features per sample (one row per tap per day):
          0  day_of_week
          1  is_weekend
          2  people_count
          3  tap_rolling_avg_3d
          4  tap_rolling_avg_7d
          5..5+len(_LOCATION_CATS)-1  one-hot location
        """
        results = []
        total_predicted = 0.0

        for tid in tap_ids:
            meta = tap_meta[tid]
            loc = (meta.get("location") or "general").lower()
            daily = tap_date_usage.get(tid, {})

            # Build ordered usage series aligned to sorted_dates
            usages = [daily.get(d, 0.0) for d in sorted_dates]
            n = len(usages)

            if n < 3:
                # Not enough data for this tap — use mean of live
                avg = meta.get("current_usage", 0.0)
                results.append(self._make_result(tid, meta, avg))
                total_predicted += max(avg, 0.01)
                continue

            # Build features
            X = np.zeros((n, 5 + len(_LOCATION_CATS)), dtype=np.float64)
            for i, d_str in enumerate(sorted_dates):
                dt = datetime.datetime.strptime(d_str, "%Y-%m-%d").date()
                X[i, 0] = dt.weekday()
                X[i, 1] = 1.0 if dt.weekday() >= 5 else 0.0
                X[i, 2] = people_count
                if i >= 3:
                    X[i, 3] = np.mean(usages[i-3:i])
                if i >= 7:
                    X[i, 4] = np.mean(usages[i-7:i])
                # one-hot location
                for j, cat in enumerate(_LOCATION_CATS):
                    if loc == cat:
                        X[i, 5 + j] = 1.0

            y = np.array(usages, dtype=np.float64)

            model = lgb.LGBMRegressor(
                objective="regression", metric="rmse",
                learning_rate=0.1, num_leaves=10,
                min_child_samples=2, n_estimators=60,
                verbosity=-1, force_col_wise=True,
            )
            model.fit(X, y)

            # Predict "typical day" — use the last row's features as template
            pred = float(model.predict(X[-1:])[0])
            pred = max(0.0, pred)

            avg_daily = float(np.mean(usages)) if usages else 0.0
            # Blend model prediction with historical average for stability
            blended = 0.6 * pred + 0.4 * avg_daily

            results.append(self._make_result(tid, meta, blended))
            total_predicted += max(blended, 0.01)

        # Assign proportional limits
        return self._assign_limits(results, total_predicted,
                                   household_green, household_orange,
                                   model_type="lightgbm")

    # ── proportional fallback ───────────────────────────────
    def _predict_proportional(self, tap_ids, tap_meta, tap_date_usage,
                              all_dates, household_green, household_orange):
        results = []
        total_usage = 0.0

        for tid in tap_ids:
            meta = tap_meta[tid]
            daily = tap_date_usage.get(tid, {})

            if daily:
                avg = sum(daily.values()) / max(len(all_dates), 1)
            else:
                avg = meta.get("current_usage", 0.0)

            results.append(self._make_result(tid, meta, avg))
            total_usage += max(avg, 0.01)

        return self._assign_limits(results, total_usage,
                                   household_green, household_orange,
                                   model_type="proportional_fallback")

    # ── helpers ─────────────────────────────────────────────
    @staticmethod
    def _make_result(tid, meta, avg_daily):
        return {
            "tap_id": tid,
            "tap_name": meta.get("tap_name", ""),
            "location": meta.get("location", ""),
            "avg_daily_usage": round(avg_daily, 2),
        }

    @staticmethod
    def _assign_limits(results, total_predicted, household_green,
                       household_orange, model_type):
        tap_limits = []
        for r in results:
            share = r["avg_daily_usage"] / total_predicted if total_predicted > 0 else (1.0 / max(len(results), 1))
            tap_limits.append({
                **r,
                "usage_share_pct": round(share * 100, 1),
                "recommended_green": round(household_green * share, 1),
                "recommended_orange": round(household_orange * share, 1),
            })
        return {
            "model_type": model_type,
            "tap_limits": tap_limits,
            "household_green": household_green,
            "household_orange": household_orange,
        }
