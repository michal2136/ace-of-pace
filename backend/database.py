import os
from sqlmodel import create_engine, SQLModel, Session
from dotenv import load_dotenv

load_dotenv()

# Domyślnie użyjemy SQLite i schowamy plik bazy do folderu ./data
os.makedirs("data", exist_ok=True)
SQLITE_FILE_NAME = "data/smart_loop.db"
sqlite_url = f"sqlite:///{SQLITE_FILE_NAME}"

engine = create_engine(sqlite_url, echo=False)

def get_session():
    with Session(engine) as session:
        yield session

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
