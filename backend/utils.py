"""Safe file validation, unique naming, path guards, and ZIP manifest helpers."""

import io
import re
import uuid
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageOps, UnidentifiedImageError

from config import ALLOWED_EXTENSIONS, ALLOWED_PIL_FORMATS, MAX_UPLOAD_SIZE_BYTES

SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(filename: str) -> str:
    """Strip directory components and sanitize unsafe characters from a filename."""
    basename = Path(filename or "image.png").name
    cleaned = SAFE_FILENAME_RE.sub("_", basename).strip("._")
    return cleaned or "image.png"


def generate_unique_filename(original_filename: str, prefix: str = "", ext_override: str | None = None) -> str:
    """Generate a collision-free filename preserving a safe readable stem."""
    safe = sanitize_filename(original_filename)
    path_obj = Path(safe)
    stem = path_obj.stem[:48] or "image"
    ext = (ext_override or path_obj.suffix or ".png").lower()
    if not ext.startswith("."):
        ext = f".{ext}"
    token = uuid.uuid4().hex[:12]
    prefix_part = f"{prefix}_" if prefix else ""
    return f"{prefix_part}{stem}_{token}{ext}"


def resolve_safe_path(base_dir: Path, target_name: str) -> Path:
    """Resolve a path strictly inside base_dir, rejecting any path traversal."""
    if (
        not target_name
        or Path(target_name).is_absolute()
        or ".." in target_name
        or "/" in target_name
        or "\\" in target_name
    ):
        raise ValueError("Invalid filename or path traversal attempt.")
    candidate = (base_dir / target_name).resolve()
    base_resolved = base_dir.resolve()
    if candidate != base_resolved and base_resolved not in candidate.parents:
        raise ValueError("Access outside designated storage directory is forbidden.")
    return candidate


def validate_uploaded_image_bytes(
    data: bytes,
    original_filename: str,
) -> Tuple[str, str, int, int, int]:
    """Validate uploaded bytes and extract safe format and dimensions.

    Returns:
        (safe_original_filename, file_format, width, height, file_size)
    """
    if not data:
        raise ValueError("Uploaded file is empty.")

    file_size = len(data)
    if file_size > MAX_UPLOAD_SIZE_BYTES:
        max_mb = MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)
        raise ValueError(f"File '{original_filename}' exceeds the {max_mb} MB limit.")

    safe_name = sanitize_filename(original_filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file extension '{ext or 'none'}'. Allowed: JPG, JPEG, PNG, WEBP."
        )

    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
        with Image.open(io.BytesIO(data)) as img:
            img_format = (img.format or "").upper()
            if img_format not in ALLOWED_PIL_FORMATS:
                raise ValueError(
                    f"Unsupported image content format '{img_format}'. Allowed: JPEG, PNG, WEBP."
                )
            transposed = ImageOps.exif_transpose(img)
            width, height = transposed.size
            if width <= 0 or height <= 0:
                raise ValueError("Image has invalid dimensions.")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError(f"Corrupted or unreadable image file '{safe_name}'.") from exc

    return safe_name, img_format, width, height, file_size


def format_extension_for_pil(file_format: str) -> str:
    """Map stored format string to canonical lowercase file extension."""
    fmt = (file_format or "PNG").upper()
    if fmt in {"JPG", "JPEG"}:
        return ".jpg"
    if fmt == "WEBP":
        return ".webp"
    return ".png"
