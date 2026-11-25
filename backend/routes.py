"""REST API routes for ReefAugment AI."""

import base64
import io
import json
import uuid
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy import asc, desc, func, text
from sqlalchemy.orm import Session, joinedload

from augmentation import (
    TECHNIQUE_CATALOG,
    TECHNIQUE_MAP,
    apply_pipeline,
    get_technique_label,
    load_rgb_image,
    save_rgb_image,
    validate_and_normalize_params,
)
from config import OUTPUT_DIR, TEMP_DIR, UPLOAD_DIR, ensure_directories
from database import SessionLocal, get_db
from models import AugmentationResult, ProcessingHistory, ProcessingJob, UploadedImage, utc_now
from schemas import (
    AugmentationResultResponse,
    AugmentPreviewResponse,
    AugmentRequest,
    BatchItemResult,
    BatchJobStatusResponse,
    BatchRequest,
    ComparisonResponse,
    DashboardResponse,
    HistoryEntryResponse,
    SummaryChartsResponse,
    SummaryResponse,
    TechniqueMeta,
    UploadBatchResponse,
    UploadedImageResponse,
    ZipExportRequest,
)
from utils import (
    format_extension_for_pil,
    generate_unique_filename,
    resolve_safe_path,
    validate_uploaded_image_bytes,
)

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Serialization Helpers
# ---------------------------------------------------------------------------

def _serialize_uploaded_image(img: UploadedImage, aug_count: int = 0) -> UploadedImageResponse:
    return UploadedImageResponse(
        id=img.id,
        original_filename=img.original_filename,
        stored_filename=img.stored_filename,
        file_format=img.file_format,
        file_size=img.file_size,
        width=img.width,
        height=img.height,
        uploaded_at=img.uploaded_at,
        image_url=f"/static/uploads/{img.stored_filename}",
        augmentation_count=aug_count,
    )


def _serialize_result(res: AugmentationResult) -> AugmentationResultResponse:
    orig = res.original_image
    return AugmentationResultResponse(
        id=res.id,
        original_image_id=res.original_image_id,
        original_filename=orig.original_filename if orig else None,
        original_image_url=f"/static/uploads/{orig.stored_filename}" if orig else None,
        job_id=res.job_id,
        output_filename=res.output_filename,
        technique=res.technique,
        technique_label=get_technique_label(res.technique),
        parameters=res.parameters or {},
        width=res.width,
        height=res.height,
        file_size=res.file_size,
        created_at=res.created_at,
        image_url=f"/static/outputs/{res.output_filename}",
        download_url=f"/api/results/{res.id}/download",
    )


def _serialize_history(entry: ProcessingHistory) -> HistoryEntryResponse:
    has_result = entry.result_id is not None and entry.result is not None
    return HistoryEntryResponse(
        id=entry.id,
        job_id=entry.job_id,
        original_image_id=entry.original_image_id,
        result_id=entry.result_id,
        original_filename=entry.original_filename,
        output_filename=entry.output_filename,
        technique=entry.technique,
        technique_label=get_technique_label(entry.technique),
        parameters=entry.parameters or {},
        status=entry.status,
        created_at=entry.created_at,
        error_message=entry.error_message,
        result_image_url=f"/static/outputs/{entry.result.output_filename}" if has_result else None,
        download_url=f"/api/results/{entry.result_id}/download" if has_result else None,
    )


def _cleanup_file(path: Path) -> None:
    """Safely remove a temporary file after response streaming completes."""
    try:
        if path.exists() and path.is_file():
            path.unlink()
    except OSError:
        pass


def _build_zip_export(
    results: List[AugmentationResult],
    zip_filename: str,
    background_tasks: BackgroundTasks,
) -> FileResponse:
    """Package augmentation results and manifest.json into a temporary ZIP."""
    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated images available for export.",
        )

    ensure_directories()
    temp_name = f"export_{uuid.uuid4().hex[:12]}.zip"
    zip_path = (TEMP_DIR / temp_name).resolve()

    manifest_items: List[Dict[str, Any]] = []
    added_files = 0

    with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for res in results:
            try:
                file_path = resolve_safe_path(OUTPUT_DIR, res.output_filename)
            except ValueError:
                continue
            if not file_path.exists() or not file_path.is_file():
                continue

            safe_arc_name = f"images/{Path(res.output_filename).name}"
            zf.write(file_path, arcname=safe_arc_name)
            added_files += 1

            orig_filename = (
                res.original_image.original_filename if res.original_image else "unknown"
            )
            manifest_items.append(
                {
                    "job_id": res.job_id,
                    "result_id": res.id,
                    "original_image_id": res.original_image_id,
                    "original_filename": orig_filename,
                    "generated_filename": res.output_filename,
                    "archive_path": safe_arc_name,
                    "technique": res.technique,
                    "technique_label": get_technique_label(res.technique),
                    "parameters": res.parameters or {},
                    "width": res.width,
                    "height": res.height,
                    "file_size": res.file_size,
                    "generation_timestamp": res.created_at.isoformat(),
                }
            )

        if added_files == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No generated image files were found on disk for export.",
            )

        manifest_payload = {
            "application": "ReefAugment AI",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "total_images": added_files,
            "items": manifest_items,
        }
        zf.writestr("manifest.json", json.dumps(manifest_payload, indent=2))

    background_tasks.add_task(_cleanup_file, zip_path)
    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=zip_filename,
        background=background_tasks,
    )


# ---------------------------------------------------------------------------
# General & Metadata Endpoints
# ---------------------------------------------------------------------------

@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    """Verify API readiness, SQLite connectivity, and local storage directories."""
    ensure_directories()
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "app": "ReefAugment AI",
        "database": "connected",
        "techniques_count": len(TECHNIQUE_CATALOG),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/techniques", response_model=List[TechniqueMeta])
def list_techniques():
    """Return metadata and parameter schemas for all 15 augmentation techniques."""
    return TECHNIQUE_CATALOG


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(db: Session = Depends(get_db)):
    """Aggregate real statistics and recent activity for the dashboard."""
    total_uploaded = db.query(func.count(UploadedImage.id)).scalar() or 0
    total_augmented = db.query(func.count(AugmentationResult.id)).scalar() or 0
    total_jobs = db.query(func.count(ProcessingJob.id)).scalar() or 0

    orig_bytes = db.query(func.coalesce(func.sum(UploadedImage.file_size), 0)).scalar() or 0
    aug_bytes = db.query(func.coalesce(func.sum(AugmentationResult.file_size), 0)).scalar() or 0

    recent_uploads = (
        db.query(UploadedImage)
        .order_by(desc(UploadedImage.uploaded_at), desc(UploadedImage.id))
        .limit(6)
        .all()
    )

    upload_counts = dict(
        db.query(AugmentationResult.original_image_id, func.count(AugmentationResult.id))
        .group_by(AugmentationResult.original_image_id)
        .all()
    )

    recent_results = (
        db.query(AugmentationResult)
        .options(joinedload(AugmentationResult.original_image))
        .order_by(desc(AugmentationResult.created_at), desc(AugmentationResult.id))
        .limit(6)
        .all()
    )

    recent_history = (
        db.query(ProcessingHistory)
        .options(joinedload(ProcessingHistory.result))
        .order_by(desc(ProcessingHistory.created_at), desc(ProcessingHistory.id))
        .limit(8)
        .all()
    )

    # Build real daily activity series from persisted records
    daily_buckets: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"date": "", "uploaded": 0, "augmented": 0, "failed": 0}
    )
    for (ts,) in db.query(UploadedImage.uploaded_at).all():
        day = ts.strftime("%Y-%m-%d")
        daily_buckets[day]["date"] = day
        daily_buckets[day]["uploaded"] += 1

    for (ts, status_val) in db.query(ProcessingHistory.created_at, ProcessingHistory.status).all():
        day = ts.strftime("%Y-%m-%d")
        daily_buckets[day]["date"] = day
        if status_val == "success":
            daily_buckets[day]["augmented"] += 1
        else:
            daily_buckets[day]["failed"] += 1

    activity_chart = [daily_buckets[k] for k in sorted(daily_buckets.keys())[-14:]]

    tech_rows = (
        db.query(AugmentationResult.technique, func.count(AugmentationResult.id))
        .group_by(AugmentationResult.technique)
        .order_by(desc(func.count(AugmentationResult.id)))
        .limit(10)
        .all()
    )
    technique_chart = [
        {"technique": tech, "label": get_technique_label(tech), "count": cnt}
        for tech, cnt in tech_rows
    ]

    return DashboardResponse(
        total_uploaded_images=total_uploaded,
        total_augmented_images=total_augmented,
        total_processing_jobs=total_jobs,
        total_techniques=len(TECHNIQUE_CATALOG),
        total_storage_bytes=int(orig_bytes + aug_bytes),
        recent_uploaded_images=[
            _serialize_uploaded_image(img, upload_counts.get(img.id, 0)) for img in recent_uploads
        ],
        recent_generated_images=[_serialize_result(r) for r in recent_results],
        recent_activity=[_serialize_history(h) for h in recent_history],
        activity_chart=activity_chart,
        technique_chart=technique_chart,
    )


# ---------------------------------------------------------------------------
# Upload & Original Image Endpoints
# ---------------------------------------------------------------------------

@router.post("/upload", response_model=UploadBatchResponse, status_code=status.HTTP_201_CREATED)
async def upload_images(
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    """Upload one or multiple underwater species images with strict validation."""
    ensure_directories()
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files were provided for upload.",
        )

    uploaded_responses: List[UploadedImageResponse] = []
    errors: List[Dict[str, str]] = []

    for upload in files:
        orig_name = upload.filename or "unnamed"
        try:
            raw_bytes = await upload.read()
            safe_name, img_format, width, height, file_size = validate_uploaded_image_bytes(
                raw_bytes, orig_name
            )
            ext = format_extension_for_pil(img_format)
            stored_filename = generate_unique_filename(safe_name, prefix="orig", ext_override=ext)
            dest_path = resolve_safe_path(UPLOAD_DIR, stored_filename)
            dest_path.write_bytes(raw_bytes)

            record = UploadedImage(
                original_filename=safe_name,
                stored_filename=stored_filename,
                file_path=f"uploads/{stored_filename}",
                file_format=img_format,
                file_size=file_size,
                width=width,
                height=height,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            uploaded_responses.append(_serialize_uploaded_image(record, 0))
        except ValueError as exc:
            db.rollback()
            errors.append({"filename": orig_name, "error": str(exc)})
        except Exception as exc:
            db.rollback()
            errors.append({"filename": orig_name, "error": f"Failed to save image: {exc}"})
        finally:
            await upload.close()

    if not uploaded_responses and errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="; ".join(f"{e['filename']}: {e['error']}" for e in errors),
        )

    return UploadBatchResponse(uploaded=uploaded_responses, errors=errors)


@router.get("/images", response_model=List[UploadedImageResponse])
def list_uploaded_images(
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List all uploaded original underwater images."""
    query = db.query(UploadedImage)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(UploadedImage.original_filename.ilike(pattern))

    images = query.order_by(desc(UploadedImage.uploaded_at), desc(UploadedImage.id)).all()
    counts = dict(
        db.query(AugmentationResult.original_image_id, func.count(AugmentationResult.id))
        .group_by(AugmentationResult.original_image_id)
        .all()
    )
    return [_serialize_uploaded_image(img, counts.get(img.id, 0)) for img in images]


@router.get("/images/{image_id}", response_model=UploadedImageResponse)
def get_uploaded_image(image_id: int, db: Session = Depends(get_db)):
    """Get metadata for a single uploaded image."""
    img = db.query(UploadedImage).filter(UploadedImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded image not found.")
    count = (
        db.query(func.count(AugmentationResult.id))
        .filter(AugmentationResult.original_image_id == image_id)
        .scalar()
        or 0
    )
    return _serialize_uploaded_image(img, count)


@router.get("/images/{image_id}/download")
def download_uploaded_image(image_id: int, db: Session = Depends(get_db)):
    """Download the preserved original uploaded image."""
    img = db.query(UploadedImage).filter(UploadedImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded image not found.")
    file_path = resolve_safe_path(UPLOAD_DIR, img.stored_filename)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original image file missing from storage.")
    return FileResponse(path=str(file_path), filename=img.original_filename)


@router.delete("/images/{image_id}")
def delete_uploaded_image(image_id: int, db: Session = Depends(get_db)):
    """Delete an uploaded image and its dependent output files safely."""
    img = (
        db.query(UploadedImage)
        .options(joinedload(UploadedImage.augmentation_results))
        .filter(UploadedImage.id == image_id)
        .first()
    )
    if not img:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded image not found.")

    output_filenames = [res.output_filename for res in img.augmentation_results]
    stored_filename = img.stored_filename

    db.delete(img)
    db.commit()

    # Remove disk files inside designated storage folders only
    try:
        orig_path = resolve_safe_path(UPLOAD_DIR, stored_filename)
        if orig_path.exists() and orig_path.is_file():
            orig_path.unlink()
    except (ValueError, OSError):
        pass

    for out_name in output_filenames:
        try:
            out_path = resolve_safe_path(OUTPUT_DIR, out_name)
            if out_path.exists() and out_path.is_file():
                out_path.unlink()
        except (ValueError, OSError):
            pass

    return {"status": "deleted", "deleted_image_id": image_id}


# ---------------------------------------------------------------------------
# Augmentation Studio & Results Gallery Endpoints
# ---------------------------------------------------------------------------

def _resolve_steps_from_request(payload: AugmentRequest) -> List[Dict[str, Any]]:
    if payload.steps and len(payload.steps) > 0:
        return [{"technique": s.technique, "parameters": s.parameters} for s in payload.steps]
    if payload.technique:
        return [{"technique": payload.technique, "parameters": payload.parameters}]
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Provide either 'technique' or a non-empty list of 'steps'.",
    )


@router.post("/augment")
def augment_image(payload: AugmentRequest, db: Session = Depends(get_db)):
    """Apply one or more sequential augmentation techniques via Python/OpenCV/Albumentations."""
    ensure_directories()
    steps = _resolve_steps_from_request(payload)

    # Validate all technique keys & parameters before reading files or writing DB rows
    for step in steps:
        try:
            validate_and_normalize_params(step["technique"], step.get("parameters"))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    orig = db.query(UploadedImage).filter(UploadedImage.id == payload.image_id).first()
    if not orig:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded image not found.")

    src_path = resolve_safe_path(UPLOAD_DIR, orig.stored_filename)
    if not src_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source image file is missing from disk.",
        )

    try:
        rgb = load_rgb_image(src_path)
        transformed_rgb, technique_key, normalized_params = apply_pipeline(rgb, steps)
    except Exception as exc:
        if payload.save_to_gallery:
            failed_job = ProcessingJob(
                job_type="pipeline" if len(steps) > 1 else "single",
                status="failed",
                total_images=1,
                completed_images=0,
                failed_images=1,
                config_json={"steps": steps},
                completed_at=utc_now(),
                error_message=str(exc),
            )
            db.add(failed_job)
            db.flush()
            history_entry = ProcessingHistory(
                job_id=failed_job.id,
                original_image_id=orig.id,
                result_id=None,
                original_filename=orig.original_filename,
                output_filename=None,
                technique="+".join(s["technique"] for s in steps),
                parameters={"steps": steps} if len(steps) > 1 else (steps[0].get("parameters") or {}),
                status="failed",
                error_message=str(exc),
            )
            db.add(history_entry)
            db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Image augmentation failed: {exc}",
        ) from exc

    if not payload.save_to_gallery:
        buf = io.BytesIO()
        pil_preview = Image.fromarray(transformed_rgb, mode="RGB")
        pil_preview.save(buf, format="PNG")
        encoded = base64.b64encode(buf.getvalue()).decode("ascii")
        width, height = pil_preview.size
        return AugmentPreviewResponse(
            image_id=orig.id,
            technique=technique_key,
            parameters=normalized_params,
            width=width,
            height=height,
            file_size=len(buf.getvalue()),
            preview_data_url=f"data:image/png;base64,{encoded}",
        )

    # Save generated output separately from original upload
    out_ext = format_extension_for_pil(orig.file_format)
    prefix = steps[0]["technique"] if len(steps) == 1 else "pipeline"
    output_filename = generate_unique_filename(
        orig.original_filename,
        prefix=prefix,
        ext_override=out_ext,
    )
    out_path = resolve_safe_path(OUTPUT_DIR, output_filename)
    width, height, file_size = save_rgb_image(transformed_rgb, out_path, orig.file_format)

    job = ProcessingJob(
        job_type="pipeline" if len(steps) > 1 else "single",
        status="completed",
        total_images=1,
        completed_images=1,
        failed_images=0,
        config_json={"steps": steps},
        completed_at=utc_now(),
    )
    db.add(job)
    db.flush()

    result_row = AugmentationResult(
        original_image_id=orig.id,
        job_id=job.id,
        output_filename=output_filename,
        output_path=f"outputs/{output_filename}",
        technique=technique_key,
        parameters=normalized_params,
        width=width,
        height=height,
        file_size=file_size,
    )
    db.add(result_row)
    db.flush()

    history_row = ProcessingHistory(
        job_id=job.id,
        original_image_id=orig.id,
        result_id=result_row.id,
        original_filename=orig.original_filename,
        output_filename=output_filename,
        technique=technique_key,
        parameters=normalized_params,
        status="success",
    )
    db.add(history_row)
    db.commit()
    db.refresh(result_row)

    # Load relationship for serialized response
    result_with_orig = (
        db.query(AugmentationResult)
        .options(joinedload(AugmentationResult.original_image))
        .filter(AugmentationResult.id == result_row.id)
        .first()
    )
    return _serialize_result(result_with_orig)


@router.get("/results")
def list_results(
    technique: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("newest"),
    original_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List generated augmentation results with filtering, searching, sorting, and pagination."""
    query = db.query(AugmentationResult).options(joinedload(AugmentationResult.original_image))

    if technique and technique.strip() and technique != "all":
        query = query.filter(AugmentationResult.technique.contains(technique.strip()))

    if original_id is not None:
        query = query.filter(AugmentationResult.original_image_id == original_id)

    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.join(AugmentationResult.original_image).filter(
            AugmentationResult.output_filename.ilike(pattern)
            | UploadedImage.original_filename.ilike(pattern)
        )

    total = query.count()

    if sort == "oldest":
        query = query.order_by(asc(AugmentationResult.created_at), asc(AugmentationResult.id))
    else:
        query = query.order_by(desc(AugmentationResult.created_at), desc(AugmentationResult.id))

    rows = query.offset(offset).limit(limit).all()
    return {
        "items": [_serialize_result(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/results/{result_id}", response_model=AugmentationResultResponse)
def get_result(result_id: int, db: Session = Depends(get_db)):
    """Get details of a single generated result."""
    res = (
        db.query(AugmentationResult)
        .options(joinedload(AugmentationResult.original_image))
        .filter(AugmentationResult.id == result_id)
        .first()
    )
    if not res:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Augmentation result not found.")
    return _serialize_result(res)


@router.get("/results/{result_id}/download")
def download_result(result_id: int, db: Session = Depends(get_db)):
    """Download a single generated output image."""
    res = db.query(AugmentationResult).filter(AugmentationResult.id == result_id).first()
    if not res:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Augmentation result not found.")
    file_path = resolve_safe_path(OUTPUT_DIR, res.output_filename)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generated image file missing from disk.")
    return FileResponse(path=str(file_path), filename=res.output_filename)


@router.delete("/results/{result_id}")
def delete_result(result_id: int, db: Session = Depends(get_db)):
    """Delete a generated output image without touching the original uploaded image."""
    res = db.query(AugmentationResult).filter(AugmentationResult.id == result_id).first()
    if not res:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Augmentation result not found.")

    out_filename = res.output_filename
    db.delete(res)
    db.commit()

    try:
        out_path = resolve_safe_path(OUTPUT_DIR, out_filename)
        if out_path.exists() and out_path.is_file():
            out_path.unlink()
    except (ValueError, OSError):
        pass

    return {"status": "deleted", "deleted_result_id": result_id}


# ---------------------------------------------------------------------------
# Batch Processing Endpoints
# ---------------------------------------------------------------------------

def _variation_params(
    technique_key: str,
    base_params: Dict[str, Any],
    variation_idx: int,
) -> Dict[str, Any]:
    """Derive deterministic varied parameters for multi-variation batch runs."""
    if variation_idx == 0:
        return validate_and_normalize_params(technique_key, base_params)

    varied = dict(base_params)
    sign = -1 if variation_idx % 2 == 1 else 1
    step_mag = (variation_idx + 1) // 2

    if technique_key == "rotation":
        base_angle = float(varied.get("angle", 25.0))
        candidate = base_angle * sign + sign * (step_mag - 1) * 15.0
        varied["angle"] = max(-180.0, min(180.0, candidate))
    elif technique_key == "zoom_crop":
        base_zoom = float(varied.get("zoom_factor", 1.5))
        varied["zoom_factor"] = round(min(3.0, max(1.05, base_zoom + sign * 0.15 * step_mag)), 2)
        varied["center_x"] = round(min(0.85, max(0.15, float(varied.get("center_x", 0.5)) + sign * 0.08 * step_mag)), 2)
    elif technique_key == "brightness":
        base_val = float(varied.get("factor", 0.25))
        varied["factor"] = round(max(-0.8, min(0.8, base_val + sign * 0.12 * step_mag)), 2)
    elif technique_key == "contrast":
        base_val = float(varied.get("factor", 1.4))
        varied["factor"] = round(max(0.2, min(2.5, base_val + sign * 0.18 * step_mag)), 2)
    elif technique_key == "saturation":
        base_val = float(varied.get("factor", 1.5))
        varied["factor"] = round(max(0.0, min(2.5, base_val + sign * 0.20 * step_mag)), 2)
    elif technique_key == "hue":
        base_val = int(varied.get("shift", 25))
        varied["shift"] = max(-180, min(180, base_val * sign + sign * 15 * (step_mag - 1)))
    elif technique_key == "noise":
        base_val = float(varied.get("intensity", 0.08))
        varied["intensity"] = round(max(0.01, min(0.5, base_val + 0.03 * variation_idx)), 2)
    elif technique_key == "blur":
        base_val = int(varied.get("intensity", 5))
        varied["intensity"] = max(1, min(25, base_val + sign * 2 * step_mag))
    elif technique_key == "underwater_haze":
        base_val = float(varied.get("intensity", 0.45))
        varied["intensity"] = round(max(0.05, min(0.9, base_val + sign * 0.1 * step_mag)), 2)
    elif technique_key == "underwater_particles":
        base_dens = float(varied.get("density", 0.4))
        varied["density"] = round(max(0.05, min(1.0, base_dens + sign * 0.12 * step_mag)), 2)
    elif technique_key == "perspective":
        dirs = ["left", "right", "top", "bottom", "random"]
        varied["direction"] = dirs[variation_idx % len(dirs)]
    elif technique_key == "elastic":
        base_alpha = float(varied.get("alpha", 30.0))
        varied["alpha"] = min(80.0, max(5.0, base_alpha + sign * 8.0 * step_mag))

    return validate_and_normalize_params(technique_key, varied)


def _execute_batch_job(job_id: int) -> None:
    """Execute a batch job in the background, updating SQLite incrementally."""
    db = SessionLocal()
    try:
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
        if not job:
            return

        job.status = "processing"
        db.commit()

        config = job.config_json or {}
        image_ids: List[int] = config.get("image_ids", [])
        techniques: List[str] = config.get("techniques", [])
        variations: int = int(config.get("variations_per_technique", 1))
        tech_params: Dict[str, Dict[str, Any]] = config.get("technique_parameters", {})

        item_counter = 0
        for img_id in image_ids:
            orig = db.query(UploadedImage).filter(UploadedImage.id == img_id).first()
            for tech in techniques:
                base_params = tech_params.get(tech, {})
                for var_idx in range(variations):
                    item_counter += 1
                    try:
                        if not orig:
                            raise ValueError(f"Uploaded image ID {img_id} was not found.")

                        src_path = resolve_safe_path(UPLOAD_DIR, orig.stored_filename)
                        if not src_path.exists():
                            raise FileNotFoundError(
                                f"Original file '{orig.original_filename}' missing from disk."
                            )

                        norm_params = _variation_params(tech, base_params, var_idx)
                        rgb = load_rgb_image(src_path)
                        transformed, tech_key, used_params = apply_pipeline(
                            rgb,
                            [{"technique": tech, "parameters": norm_params}],
                            seed=job_id * 1000 + item_counter,
                        )

                        out_ext = format_extension_for_pil(orig.file_format)
                        out_filename = generate_unique_filename(
                            orig.original_filename,
                            prefix=f"batch_{tech}_v{var_idx + 1}",
                            ext_override=out_ext,
                        )
                        out_path = resolve_safe_path(OUTPUT_DIR, out_filename)
                        width, height, file_size = save_rgb_image(
                            transformed, out_path, orig.file_format
                        )

                        result_row = AugmentationResult(
                            original_image_id=orig.id,
                            job_id=job.id,
                            output_filename=out_filename,
                            output_path=f"outputs/{out_filename}",
                            technique=tech_key,
                            parameters={**used_params, "_variation": var_idx + 1},
                            width=width,
                            height=height,
                            file_size=file_size,
                        )
                        db.add(result_row)
                        db.flush()

                        history_row = ProcessingHistory(
                            job_id=job.id,
                            original_image_id=orig.id,
                            result_id=result_row.id,
                            original_filename=orig.original_filename,
                            output_filename=out_filename,
                            technique=tech_key,
                            parameters={**used_params, "_variation": var_idx + 1},
                            status="success",
                        )
                        db.add(history_row)
                        job.completed_images += 1
                        db.commit()

                    except Exception as exc:
                        db.rollback()
                        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
                        if not job:
                            return
                        history_row = ProcessingHistory(
                            job_id=job.id,
                            original_image_id=orig.id if orig else None,
                            result_id=None,
                            original_filename=orig.original_filename if orig else f"image_{img_id}",
                            output_filename=None,
                            technique=tech,
                            parameters={**base_params, "_variation": var_idx + 1},
                            status="failed",
                            error_message=str(exc),
                        )
                        db.add(history_row)
                        job.failed_images += 1
                        db.commit()

        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
        if job:
            if job.failed_images == 0:
                job.status = "completed"
            elif job.completed_images > 0:
                job.status = "completed_with_errors"
                job.error_message = f"{job.failed_images} item(s) failed during batch execution."
            else:
                job.status = "failed"
                job.error_message = "All items in the batch job failed."
            job.completed_at = utc_now()
            db.commit()
    finally:
        db.close()


def _build_batch_status_response(job: ProcessingJob, db: Session) -> BatchJobStatusResponse:
    history_rows = (
        db.query(ProcessingHistory)
        .options(joinedload(ProcessingHistory.result))
        .filter(ProcessingHistory.job_id == job.id)
        .order_by(asc(ProcessingHistory.id))
        .all()
    )
    items: List[BatchItemResult] = []
    for row in history_rows:
        has_result = row.result_id is not None and row.result is not None
        var_idx = int((row.parameters or {}).get("_variation", 1))
        items.append(
            BatchItemResult(
                history_id=row.id,
                original_image_id=row.original_image_id or 0,
                original_filename=row.original_filename,
                technique=row.technique,
                variation_index=var_idx,
                status=row.status,
                result_id=row.result_id,
                output_filename=row.output_filename,
                image_url=f"/static/outputs/{row.result.output_filename}" if has_result else None,
                error_message=row.error_message,
            )
        )

    processed = job.completed_images + job.failed_images
    progress = round((processed / job.total_images) * 100.0, 1) if job.total_images > 0 else 0.0

    return BatchJobStatusResponse(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        total_images=job.total_images,
        completed_images=job.completed_images,
        failed_images=job.failed_images,
        progress_percent=min(100.0, progress),
        created_at=job.created_at,
        completed_at=job.completed_at,
        error_message=job.error_message,
        config=job.config_json,
        items=items,
        download_zip_url=f"/api/batch/{job.id}/download" if job.completed_images > 0 else None,
    )


@router.post("/batch", response_model=BatchJobStatusResponse, status_code=status.HTTP_202_ACCEPTED)
def start_batch_processing(
    payload: BatchRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Queue a local batch augmentation job across multiple images and techniques."""
    ensure_directories()

    # Validate all techniques and parameters upfront
    normalized_tech_params: Dict[str, Dict[str, Any]] = {}
    for tech in payload.techniques:
        if tech not in TECHNIQUE_MAP:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown augmentation technique '{tech}'.",
            )
        try:
            normalized_tech_params[tech] = validate_and_normalize_params(
                tech, payload.technique_parameters.get(tech)
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # Ensure at least one valid image exists when starting a batch
    existing_count = (
        db.query(func.count(UploadedImage.id))
        .filter(UploadedImage.id.in_(payload.image_ids))
        .scalar()
        or 0
    )
    if existing_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="None of the selected uploaded images exist.",
        )

    total_tasks = len(payload.image_ids) * len(payload.techniques) * payload.variations_per_technique
    job = ProcessingJob(
        job_type="batch",
        status="pending",
        total_images=total_tasks,
        completed_images=0,
        failed_images=0,
        config_json={
            "image_ids": payload.image_ids,
            "techniques": payload.techniques,
            "variations_per_technique": payload.variations_per_technique,
            "technique_parameters": normalized_tech_params,
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(_execute_batch_job, job.id)
    return _build_batch_status_response(job, db)


@router.get("/batch", response_model=List[BatchJobStatusResponse])
def list_batch_jobs(db: Session = Depends(get_db)):
    """List recent batch processing jobs."""
    jobs = (
        db.query(ProcessingJob)
        .filter(ProcessingJob.job_type == "batch")
        .order_by(desc(ProcessingJob.created_at), desc(ProcessingJob.id))
        .limit(25)
        .all()
    )
    return [_build_batch_status_response(job, db) for job in jobs]


@router.get("/batch/{job_id}", response_model=BatchJobStatusResponse)
@router.get("/batch/{job_id}/status", response_model=BatchJobStatusResponse)
def get_batch_status(job_id: int, db: Session = Depends(get_db)):
    """Poll live status and individual item outcomes for a batch job."""
    job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch job not found.")
    return _build_batch_status_response(job, db)


@router.post("/batch/{job_id}/retry", response_model=BatchJobStatusResponse)
def retry_failed_batch_items(job_id: int, db: Session = Depends(get_db)):
    """Retry failed items within a batch job."""
    job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch job not found.")

    failed_rows = (
        db.query(ProcessingHistory)
        .filter(ProcessingHistory.job_id == job_id, ProcessingHistory.status == "failed")
        .all()
    )
    if not failed_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This batch job has no failed items to retry.",
        )

    for idx, row in enumerate(failed_rows):
        if not row.original_image_id:
            continue
        orig = db.query(UploadedImage).filter(UploadedImage.id == row.original_image_id).first()
        if not orig:
            continue
        try:
            src_path = resolve_safe_path(UPLOAD_DIR, orig.stored_filename)
            if not src_path.exists():
                raise FileNotFoundError(f"Original file '{orig.original_filename}' missing from disk.")

            params_copy = dict(row.parameters or {})
            var_idx = max(0, int(params_copy.pop("_variation", 1)) - 1)
            rgb = load_rgb_image(src_path)
            transformed, tech_key, used_params = apply_pipeline(
                rgb,
                [{"technique": row.technique, "parameters": params_copy}],
                seed=job_id * 2000 + idx,
            )
            out_ext = format_extension_for_pil(orig.file_format)
            out_filename = generate_unique_filename(
                orig.original_filename,
                prefix=f"retry_{row.technique}",
                ext_override=out_ext,
            )
            out_path = resolve_safe_path(OUTPUT_DIR, out_filename)
            width, height, file_size = save_rgb_image(transformed, out_path, orig.file_format)

            res = AugmentationResult(
                original_image_id=orig.id,
                job_id=job.id,
                output_filename=out_filename,
                output_path=f"outputs/{out_filename}",
                technique=tech_key,
                parameters={**used_params, "_variation": var_idx + 1},
                width=width,
                height=height,
                file_size=file_size,
            )
            db.add(res)
            db.flush()

            row.result_id = res.id
            row.output_filename = out_filename
            row.status = "success"
            row.error_message = None
            job.completed_images += 1
            job.failed_images = max(0, job.failed_images - 1)
            db.commit()
        except Exception as exc:
            db.rollback()
            row_ref = db.query(ProcessingHistory).filter(ProcessingHistory.id == row.id).first()
            if row_ref:
                row_ref.error_message = str(exc)
                db.commit()

    db.refresh(job)
    if job.failed_images == 0:
        job.status = "completed"
        job.error_message = None
    elif job.completed_images > 0:
        job.status = "completed_with_errors"
    else:
        job.status = "failed"
    job.completed_at = utc_now()
    db.commit()
    db.refresh(job)
    return _build_batch_status_response(job, db)


@router.get("/batch/{job_id}/download")
def download_batch_zip(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Export all generated images from a batch job as a ZIP with manifest.json."""
    job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch job not found.")

    results = (
        db.query(AugmentationResult)
        .options(joinedload(AugmentationResult.original_image))
        .filter(AugmentationResult.job_id == job_id)
        .order_by(asc(AugmentationResult.id))
        .all()
    )
    return _build_zip_export(results, f"reefaugment_batch_{job_id}.zip", background_tasks)


# ---------------------------------------------------------------------------
# Comparison Endpoints
# ---------------------------------------------------------------------------

@router.get("/comparison/{original_id}", response_model=ComparisonResponse)
def get_comparison(original_id: int, db: Session = Depends(get_db)):
    """Retrieve original image and all augmented versions for side-by-side comparison."""
    orig = db.query(UploadedImage).filter(UploadedImage.id == original_id).first()
    if not orig:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original image not found.")

    results = (
        db.query(AugmentationResult)
        .options(joinedload(AugmentationResult.original_image))
        .filter(AugmentationResult.original_image_id == original_id)
        .order_by(desc(AugmentationResult.created_at), desc(AugmentationResult.id))
        .all()
    )
    return ComparisonResponse(
        original=_serialize_uploaded_image(orig, len(results)),
        results=[_serialize_result(r) for r in results],
    )


# ---------------------------------------------------------------------------
# Dataset Summary & Analytics Endpoints
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=SummaryResponse)
def get_dataset_summary(db: Session = Depends(get_db)):
    """Return real SQLite dataset analytics, storage usage, and distributions."""
    total_original = db.query(func.count(UploadedImage.id)).scalar() or 0
    total_generated = db.query(func.count(AugmentationResult.id)).scalar() or 0
    total_jobs = db.query(func.count(ProcessingJob.id)).scalar() or 0
    successful_jobs = (
        db.query(func.count(ProcessingJob.id))
        .filter(ProcessingJob.status == "completed")
        .scalar()
        or 0
    )
    failed_jobs = (
        db.query(func.count(ProcessingJob.id))
        .filter(ProcessingJob.status.in_(["failed", "completed_with_errors"]))
        .scalar()
        or 0
    )

    orig_bytes = int(db.query(func.coalesce(func.sum(UploadedImage.file_size), 0)).scalar() or 0)
    aug_bytes = int(db.query(func.coalesce(func.sum(AugmentationResult.file_size), 0)).scalar() or 0)

    # Dimensions overview across all images
    uploads = db.query(UploadedImage.width, UploadedImage.height, UploadedImage.file_format).all()
    results = db.query(AugmentationResult.width, AugmentationResult.height, AugmentationResult.technique).all()

    all_widths = [w for w, _, _ in uploads] + [w for w, _, _ in results]
    all_heights = [h for _, h, _ in uploads] + [h for _, h, _ in results]

    dimensions_overview = {
        "min_width": min(all_widths) if all_widths else 0,
        "max_width": max(all_widths) if all_widths else 0,
        "avg_width": round(sum(all_widths) / len(all_widths)) if all_widths else 0,
        "min_height": min(all_heights) if all_heights else 0,
        "max_height": max(all_heights) if all_heights else 0,
        "avg_height": round(sum(all_heights) / len(all_heights)) if all_heights else 0,
    }

    format_counts: Dict[str, int] = defaultdict(int)
    for _, _, fmt in uploads:
        format_counts[fmt] += 1
    format_distribution = [
        {"format": fmt, "count": cnt} for fmt, cnt in sorted(format_counts.items())
    ]

    tech_counts: Dict[str, int] = defaultdict(int)
    for _, _, tech in results:
        tech_counts[tech] += 1
    technique_distribution = [
        {"technique": tech, "label": get_technique_label(tech), "count": cnt}
        for tech, cnt in sorted(tech_counts.items(), key=lambda x: x[1], reverse=True)
    ]

    # Count distinct base techniques actually used
    used_base_techs = set()
    for tech in tech_counts.keys():
        for part in tech.split("+"):
            if part in TECHNIQUE_MAP:
                used_base_techs.add(part)

    recent_history = (
        db.query(ProcessingHistory)
        .options(joinedload(ProcessingHistory.result))
        .order_by(desc(ProcessingHistory.created_at), desc(ProcessingHistory.id))
        .limit(10)
        .all()
    )

    return SummaryResponse(
        total_original_images=total_original,
        total_generated_images=total_generated,
        total_processing_jobs=total_jobs,
        successful_jobs=successful_jobs,
        failed_jobs=failed_jobs,
        techniques_used_count=len(used_base_techs),
        total_techniques_available=len(TECHNIQUE_CATALOG),
        total_storage_bytes=orig_bytes + aug_bytes,
        original_storage_bytes=orig_bytes,
        augmented_storage_bytes=aug_bytes,
        dimensions_overview=dimensions_overview,
        format_distribution=format_distribution,
        technique_distribution=technique_distribution,
        recent_activity=[_serialize_history(h) for h in recent_history],
    )


@router.get("/summary/charts", response_model=SummaryChartsResponse)
def get_summary_charts(db: Session = Depends(get_db)):
    """Return chart datasets derived strictly from persisted SQLite data."""
    tech_rows = (
        db.query(AugmentationResult.technique, func.count(AugmentationResult.id))
        .group_by(AugmentationResult.technique)
        .order_by(desc(func.count(AugmentationResult.id)))
        .all()
    )
    technique_distribution = [
        {"technique": t, "label": get_technique_label(t), "count": c}
        for t, c in tech_rows
    ]

    fmt_rows = (
        db.query(UploadedImage.file_format, func.count(UploadedImage.id))
        .group_by(UploadedImage.file_format)
        .all()
    )
    format_distribution = [{"format": f, "count": c} for f, c in fmt_rows]

    daily_map: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"date": "", "uploaded": 0, "augmented": 0, "failed": 0}
    )
    for (ts,) in db.query(UploadedImage.uploaded_at).all():
        d = ts.strftime("%Y-%m-%d")
        daily_map[d]["date"] = d
        daily_map[d]["uploaded"] += 1
    for (ts, status_val) in db.query(ProcessingHistory.created_at, ProcessingHistory.status).all():
        d = ts.strftime("%Y-%m-%d")
        daily_map[d]["date"] = d
        if status_val == "success":
            daily_map[d]["augmented"] += 1
        else:
            daily_map[d]["failed"] += 1

    activity_over_time = [daily_map[k] for k in sorted(daily_map.keys())]

    job_rows = (
        db.query(ProcessingJob.status, func.count(ProcessingJob.id))
        .group_by(ProcessingJob.status)
        .all()
    )
    job_status_distribution = [{"status": s, "count": c} for s, c in job_rows]

    return SummaryChartsResponse(
        technique_distribution=technique_distribution,
        format_distribution=format_distribution,
        activity_over_time=activity_over_time,
        job_status_distribution=job_status_distribution,
    )


# ---------------------------------------------------------------------------
# Processing History Endpoints
# ---------------------------------------------------------------------------

@router.get("/history")
def list_processing_history(
    search: Optional[str] = Query(None),
    technique: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Query persistent SQLite processing history with search and filters."""
    query = db.query(ProcessingHistory).options(joinedload(ProcessingHistory.result))

    if search and search.strip():
        term = search.strip()
        pattern = f"%{term}%"
        if term.isdigit():
            query = query.filter(
                ProcessingHistory.original_filename.ilike(pattern)
                | ProcessingHistory.output_filename.ilike(pattern)
                | ProcessingHistory.technique.ilike(pattern)
                | (ProcessingHistory.job_id == int(term))
            )
        else:
            query = query.filter(
                ProcessingHistory.original_filename.ilike(pattern)
                | ProcessingHistory.output_filename.ilike(pattern)
                | ProcessingHistory.technique.ilike(pattern)
            )

    if technique and technique.strip() and technique != "all":
        query = query.filter(ProcessingHistory.technique.contains(technique.strip()))

    if status_filter and status_filter.strip() and status_filter != "all":
        query = query.filter(ProcessingHistory.status == status_filter.strip())

    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from)
            query = query.filter(ProcessingHistory.created_at >= dt_from)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date_from format. Expected YYYY-MM-DD.",
            )

    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to)
            if len(date_to) == 10:
                dt_to = dt_to.replace(hour=23, minute=59, second=59)
            query = query.filter(ProcessingHistory.created_at <= dt_to)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date_to format. Expected YYYY-MM-DD.",
            )

    total = query.count()
    entries = (
        query.order_by(desc(ProcessingHistory.created_at), desc(ProcessingHistory.id))
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": [_serialize_history(e) for e in entries],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/history/{record_id}", response_model=HistoryEntryResponse)
def get_history_record(record_id: int, db: Session = Depends(get_db)):
    """Get a single processing history record by ID."""
    entry = (
        db.query(ProcessingHistory)
        .options(joinedload(ProcessingHistory.result))
        .filter(ProcessingHistory.id == record_id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="History record not found.")
    return _serialize_history(entry)


@router.delete("/history/{record_id}")
def delete_history_record(record_id: int, db: Session = Depends(get_db)):
    """Safely delete a processing history record without deleting image files."""
    entry = db.query(ProcessingHistory).filter(ProcessingHistory.id == record_id).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="History record not found.")
    db.delete(entry)
    db.commit()
    return {"status": "deleted", "deleted_history_id": record_id}


# ---------------------------------------------------------------------------
# ZIP Dataset Export Endpoints
# ---------------------------------------------------------------------------

@router.get("/export/zip")
def export_zip_get(
    background_tasks: BackgroundTasks,
    job_id: Optional[int] = Query(None),
    result_ids: Optional[str] = Query(None),
    technique: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Export all, job-specific, or selected generated images as a ZIP archive."""
    query = db.query(AugmentationResult).options(joinedload(AugmentationResult.original_image))

    if job_id is not None:
        query = query.filter(AugmentationResult.job_id == job_id)
    if technique and technique.strip() and technique != "all":
        query = query.filter(AugmentationResult.technique.contains(technique.strip()))
    if result_ids and result_ids.strip():
        try:
            parsed_ids = [int(x.strip()) for x in result_ids.split(",") if x.strip()]
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="result_ids must be a comma-separated list of integers.",
            ) from exc
        if parsed_ids:
            query = query.filter(AugmentationResult.id.in_(parsed_ids))

    results = query.order_by(asc(AugmentationResult.id)).all()
    zip_name = (
        f"reefaugment_job_{job_id}.zip"
        if job_id is not None
        else "reefaugment_dataset_export.zip"
    )
    return _build_zip_export(results, zip_name, background_tasks)


@router.post("/export/zip")
def export_zip_post(
    payload: ZipExportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Export selected generated images or a batch job as a ZIP archive."""
    query = db.query(AugmentationResult).options(joinedload(AugmentationResult.original_image))
    if payload.job_id is not None:
        query = query.filter(AugmentationResult.job_id == payload.job_id)
    if payload.result_ids:
        query = query.filter(AugmentationResult.id.in_(payload.result_ids))

    results = query.order_by(asc(AugmentationResult.id)).all()
    zip_name = (
        f"reefaugment_job_{payload.job_id}.zip"
        if payload.job_id is not None
        else "reefaugment_selected_export.zip"
    )
    return _build_zip_export(results, zip_name, background_tasks)
