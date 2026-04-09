from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from config import settings

# SQLite needs check_same_thread=False
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models import Base  # noqa
    Base.metadata.create_all(bind=engine)
    _ensure_runtime_columns()


def _ensure_runtime_columns():
    if not settings.DATABASE_URL.startswith("sqlite"):
        return

    statements = [
        "ALTER TABLE sections ADD COLUMN class_representative_name VARCHAR DEFAULT ''",
        "ALTER TABLE sections ADD COLUMN class_representative_phone VARCHAR DEFAULT ''",
    ]
    with engine.begin() as conn:
        existing = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(sections)"))
        }
        if "class_representative_name" not in existing:
            conn.execute(text(statements[0]))
        if "class_representative_phone" not in existing:
            conn.execute(text(statements[1]))
