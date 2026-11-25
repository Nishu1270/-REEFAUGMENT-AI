"""Application configuration and storage paths for ReefAugment AI."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "database"
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
TEMP_DIR = BASE_DIR / "temp_exports"

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_PIL_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

_raw_cors = os.getenv("CORS_ORIGINS", "")
CORS_ORIGINS = (
    [origin.strip() for origin in _raw_cors.split(",") if origin.strip()]
    if _raw_cors
    else DEFAULT_CORS_ORIGINS
)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(DB_DIR / 'reefaugment.db').as_posix()}",
)


def ensure_directories() -> None:
    """Ensure required local storage directories exist."""
    for directory in (DB_DIR, UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR):
        directory.mkdir(parents=True, exist_ok=True)
