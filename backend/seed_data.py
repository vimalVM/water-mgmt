import os
import random
import datetime
import firebase_admin
from firebase_admin import credentials, firestore
from app import calc_limits, get_color

cred_path = 'firebase_credentials.json'
if not firebase_admin._apps:
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)
db = firestore.client()

user_id = "1"
# Fetch user to get limits
user_doc = db.collection('users').document(user_id).get()
user_data = user_doc.to_dict() if user_doc.exists else {"people_count": 2, "base_green_per_person": 100, "base_orange_per_person": 200}
g_lim, o_lim = calc_limits(user_data)

today = datetime.date.today()
batch = db.batch()

print("Seeding 30 days of historical data...")
for i in range(1, 31):
    d = today - datetime.timedelta(days=i)
    date_str = str(d)
    
    # Generate some realistic data: lower on weekends, higher on weekdays
    if d.weekday() >= 5: # weekend
        usage = random.uniform(g_lim * 0.4, g_lim * 0.8)
    else:
        usage = random.uniform(g_lim * 0.7, g_lim * 1.2)
        
    color = get_color(usage, g_lim, o_lim)
    
    sys_id = f"{user_id}_{date_str}"
    ref = db.collection('system_daily_totals').document(sys_id)
    batch.set(ref, {
        "user_id": user_id,
        "total_usage": usage,
        "color_status": color,
        "usage_date": date_str
    })

batch.commit()
print("Seeding complete.")
