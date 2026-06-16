import os
import random
import datetime
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

load_dotenv()  # Load .env variables

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


cred_path = 'firebase_credentials.json'
if not firebase_admin._apps:
    use_emulator = os.getenv("USE_EMULATOR", "false").lower() == "true" or not os.path.exists(cred_path)
    if use_emulator:
        print("[FIREBASE] Seeding script: Using Firestore Emulator...")
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
            print(f"[FIREBASE] Error: {e}")

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
