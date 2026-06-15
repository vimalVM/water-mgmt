import os
import random
import datetime
import firebase_admin
from firebase_admin import credentials, firestore

def main():
    cred_path = 'firebase_credentials.json'
    if not os.path.exists(cred_path):
        print(f"Error: Credentials not found at {cred_path}")
        return
        
    if not firebase_admin._apps:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    # Check if there are any users in the database
    users_ref = db.collection('users').get()
    if not users_ref:
        print("No users found in the new database.")
        print("Please open http://localhost:3000, click 'Register' to create your account first, then run this script.")
        return
        
    user_doc = users_ref[0]
    user_data = user_doc.to_dict()
    user_id = user_doc.id
    email = user_data.get('email')
    print(f"Found user: {email} (ID: {user_id})")
    
    # Check if taps already exist
    taps_ref = db.collection('taps').where('user_id', '==', user_id).get()
    if not taps_ref:
        print("Adding default taps (Basin, Flush, Tap)...")
        taps_to_add = [
            {"tap_name": "Basin", "location": "Bathroom"},
            {"tap_name": "Flush", "location": "Toilet"},
            {"tap_name": "Tap", "location": "Garden"}
        ]
        for t in taps_to_add:
            new_ref = db.collection('taps').document()
            new_ref.set({
                "tap_id": new_ref.id,
                "user_id": user_id,
                "tap_name": t["tap_name"],
                "location": t["location"],
                "tap_status": "OFF",
                "current_usage": 0.0,
                "last_update": datetime.datetime.utcnow()
            })
            
    # Calculate limits
    people = user_data.get("people_count", 1) or 1
    g_lim = (user_data.get("base_green_per_person", 100) or 100) * people
    o_lim = (user_data.get("base_orange_per_person", 200) or 200) * people
    
    today = datetime.date.today()
    batch = db.batch()
    
    print("Seeding 30 days of historical data for this user...")
    for i in range(1, 31):
        d = today - datetime.timedelta(days=i)
        date_str = str(d)
        
        if d.weekday() >= 5: # weekend
            usage = random.uniform(g_lim * 0.4, g_lim * 0.8)
        else:
            usage = random.uniform(g_lim * 0.7, g_lim * 1.2)
            
        # color status
        if usage < g_lim:
            color = "green"
        elif usage < o_lim:
            color = "orange"
        else:
            color = "red"
            
        sys_id = f"{user_id}_{date_str}"
        ref = db.collection('system_daily_totals').document(sys_id)
        batch.set(ref, {
            "user_id": user_id,
            "total_usage": round(usage, 2),
            "color_status": color,
            "usage_date": date_str
        })
        
        # Also seed tap daily archives for variety
        # Let's retrieve all taps for this user (including newly created ones)
        taps = db.collection('taps').where('user_id', '==', user_id).get()
        for t in taps:
            tap_id = t.id
            share = random.uniform(0.1, 0.5)
            arch_id = f"{tap_id}_{date_str}"
            batch.set(db.collection('tap_daily_archive').document(arch_id), {
                "tap_id": tap_id,
                "user_id": user_id,
                "usage_liters": round(usage * share, 2),
                "archive_date": date_str
            })
            
    batch.commit()
    print("Seeding complete. Refresh your dashboard to see your historical data and taps!")

if __name__ == "__main__":
    main()
