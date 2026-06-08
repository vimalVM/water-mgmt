import os
import re
import datetime
import firebase_admin
from firebase_admin import credentials, firestore

cred_path = 'firebase_credentials.json'
cred = credentials.Certificate(cred_path)
firebase_admin.initialize_app(cred)
db = firestore.client()

sql_file = r'd:\water_mgmt.sql'

def parse_inserts(table_name, sql):
    pattern = re.compile(rf"INSERT INTO `{table_name}` VALUES (.*?);", re.DOTALL)
    match = pattern.search(sql)
    if not match:
        return []
    values_str = match.group(1)
    
    tuple_pattern = re.compile(r"\((.*?)\)")
    raw_tuples = tuple_pattern.findall(values_str)
    
    res = []
    for rt in raw_tuples:
        parts = rt.split(',')
        cleaned = [p.strip().strip("'") for p in parts]
        res.append(cleaned)
    return res

with open(sql_file, 'r', encoding='utf-8') as f:
    sql = f.read()

# 1. Users
users_data = parse_inserts('users', sql)
for u in users_data:
    doc_id = str(u[0])
    dt = datetime.datetime.strptime(u[7], '%Y-%m-%d %H:%M:%S')
    db.collection('users').document(doc_id).set({
        "user_id": doc_id,
        "name": u[1],
        "email": u[2],
        "password": u[3],
        "people_count": int(u[4]),
        "base_green_per_person": float(u[5]),
        "base_orange_per_person": float(u[6]),
        "created_at": dt
    })
print(f"Migrated {len(users_data)} users.")

# 2. Taps
taps_data = parse_inserts('taps', sql)
tap_user = {}
for t in taps_data:
    doc_id = str(t[0])
    user_id = str(t[1])
    tap_user[doc_id] = user_id
    db.collection('taps').document(doc_id).set({
        "tap_id": doc_id,
        "user_id": user_id,
        "tap_name": t[2],
        "location": t[3],
        "tap_status": t[4],
        "current_usage": 0.0,
        "last_update": datetime.datetime.utcnow()
    })
print(f"Migrated {len(taps_data)} taps.")

# 3. Tap Usage Running
running_data = parse_inserts('tap_usage_running', sql)
for r in running_data:
    tap_id = str(r[0])
    dt = datetime.datetime.strptime(r[2], '%Y-%m-%d %H:%M:%S')
    db.collection('taps').document(tap_id).update({
        "current_usage": float(r[1]),
        "last_update": dt
    })
print(f"Migrated {len(running_data)} tap running usages.")

# 4. Tap Daily Archive
archive_data = parse_inserts('tap_daily_archive', sql)
for a in archive_data:
    tap_id = str(a[1])
    user_id = tap_user.get(tap_id, "1")
    arch_id = f"{tap_id}_{a[3]}"
    db.collection('tap_daily_archive').document(arch_id).set({
        "tap_id": tap_id,
        "user_id": user_id,
        "usage_liters": float(a[2]),
        "archive_date": a[3]
    })
print(f"Migrated {len(archive_data)} tap daily archives.")

# 5. System Daily Totals
sys_data = parse_inserts('system_daily_totals', sql)
for s in sys_data:
    user_id = str(s[1])
    sys_id = f"{user_id}_{s[4]}"
    db.collection('system_daily_totals').document(sys_id).set({
        "user_id": user_id,
        "total_usage": float(s[2]),
        "color_status": s[3],
        "usage_date": s[4]
    })
print(f"Migrated {len(sys_data)} system daily totals.")

# 6. Tap Usage Timeseries
ts_data = parse_inserts('tap_usage_timeseries', sql)
batch = db.batch()
count = 0
total_ts = 0
for ts in ts_data:
    tap_id = str(ts[1])
    user_id = tap_user.get(tap_id, "1")
    dt = datetime.datetime.strptime(ts[3], '%Y-%m-%d %H:%M:%S')
    
    ref = db.collection('tap_usage_timeseries').document(str(ts[0]))
    batch.set(ref, {
        "tap_id": tap_id,
        "user_id": user_id,
        "usage_liters": float(ts[2]),
        "recorded_at": dt
    })
    count += 1
    total_ts += 1
    if count == 400:
        batch.commit()
        batch = db.batch()
        count = 0
if count > 0:
    batch.commit()
print(f"Migrated {total_ts} tap usage timeseries.")

print("Data migration completed successfully!")
