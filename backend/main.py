"""FastAPI application entrypoint for ReefAugment AI."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import CORS_ORIGINS, OUTPUT_DIR, UPLOAD_DIR, ensure_directories
from database import init_db
from routes import router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize local directories and SQLite schema on startup."""
    ensure_directories()
    init_db()
    yield


app = FastAPI(
    title="ReefAugment AI API",
    description="Underwater Species Image Augmentation and Dataset Management Platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ensure_directories()
app.mount("/static/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="static_uploads")
app.mount("/static/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="static_outputs")

app.include_router(router)


@app.get("/")
def root():
    """Root landing info pointing to docs and health check."""
    return {
        "application": "ReefAugment AI",
        "docs": "/docs",
        "health": "/api/health",
    }
