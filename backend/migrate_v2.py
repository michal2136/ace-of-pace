#!/usr/bin/env python3
"""
migrate_v2.py — Bezpieczna migracja SQLite dla Smart Loop v2.
Dodaje brakujące kolumny do tabeli 'user' (idempotentna).
Uruchom raz: python migrate_v2.py
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "smart_loop.db")

NEW_COLUMNS = [
    # (column_name, sql_type_with_default)
    ("display_name",  "TEXT DEFAULT NULL"),
    ("avatar_url",    "TEXT DEFAULT NULL"),
    ("fitness_level", "TEXT DEFAULT NULL"),
    ("training_goal", "TEXT DEFAULT NULL"),
]

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "uploads", "avatars")


def migrate():
    if not os.path.exists(DB_PATH):
        print(f"⚠️  Baza danych nie istnieje pod ścieżką: {DB_PATH}")
        print("    Zostanie ona stworzona automatycznie przy starcie FastAPI.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Pobierz istniejące kolumny tabeli 'user'
    cursor.execute("PRAGMA table_info('user')")
    existing = {row[1] for row in cursor.fetchall()}

    added = []
    for col_name, col_def in NEW_COLUMNS:
        if col_name not in existing:
            sql = f"ALTER TABLE user ADD COLUMN {col_name} {col_def}"
            cursor.execute(sql)
            added.append(col_name)
            print(f"  ✅ Dodano kolumnę: {col_name}")
        else:
            print(f"  ⏭️  Kolumna już istnieje: {col_name}")

    conn.commit()
    conn.close()

    if added:
        print(f"\n✅ Migracja zakończona. Dodano {len(added)} kolumn.")
    else:
        print("\n✅ Baza jest aktualna — brak zmian.")

    # Utwórz katalog na avatary
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    print(f"📁 Katalog na avatary: {UPLOADS_DIR}")


if __name__ == "__main__":
    print("🔧 Smart Loop — Migracja v2 (User Profile)\n")
    migrate()
