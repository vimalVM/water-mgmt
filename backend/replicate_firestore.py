import sys
import os
import firebase_admin
from firebase_admin import credentials, firestore

def migrate():
    source_cred_path = 'firebase_credentials.json'
    dest_cred_path = 'firebase_credentials_old.json'

    if not os.path.exists(source_cred_path):
        print(f"Error: Source credentials file not found at '{source_cred_path}'")
        print("Please ensure your active new credentials are named 'firebase_credentials.json'")
        return
    if not os.path.exists(dest_cred_path):
        print(f"Error: Destination credentials file not found at '{dest_cred_path}'")
        print("Please ensure your old credentials are named 'firebase_credentials_old.json'")
        return

    print("Initializing source database (active new project)...")
    cred_source = credentials.Certificate(source_cred_path)
    app_source = firebase_admin.initialize_app(cred_source, name='source')
    db_source = firestore.client(app=app_source)

    print("Initializing destination database (old project)...")
    cred_dest = credentials.Certificate(dest_cred_path)
    app_dest = firebase_admin.initialize_app(cred_dest, name='dest')
    db_dest = firestore.client(app=app_dest)

    collections = [
        'users',
        'taps',
        'system_daily_totals',
        'tap_daily_archive',
        'tap_usage_timeseries'
    ]

    for col_name in collections:
        print(f"\n--- Migrating collection: {col_name} ---")
        docs = db_source.collection(col_name).get()
        print(f"Found {len(docs)} documents in source.")
        
        if not docs:
            print("Nothing to migrate for this collection.")
            continue

        batch = db_dest.batch()
        count = 0
        total_migrated = 0

        for doc in docs:
            doc_data = doc.to_dict()
            dest_ref = db_dest.collection(col_name).document(doc.id)
            batch.set(dest_ref, doc_data)
            count += 1
            total_migrated += 1
            
            # Firestore batch commits are limited to 500 operations (we use 400 to be safe)
            if count == 400:
                print(f"Committing batch of {count} documents...")
                batch.commit()
                batch = db_dest.batch()
                count = 0

        if count > 0:
            print(f"Committing final batch of {count} documents...")
            batch.commit()

        print(f"Successfully migrated {total_migrated} documents to {col_name} in new project.")

    print("\nDatabase replication completed successfully!")

if __name__ == "__main__":
    migrate()
