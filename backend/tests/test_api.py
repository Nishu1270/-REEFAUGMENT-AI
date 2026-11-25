"""Comprehensive automated test suite for ReefAugment AI backend."""

import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import config
import database
import main as app_main


@pytest.fixture()
def isolated_env(tmp_path, monkeypatch):
    """Redirect storage directories and SQLite database to a clean temp directory."""
    db_dir = tmp_path / "database"
    upload_dir = tmp_path / "uploads"
    output_dir = tmp_path / "outputs"
    temp_dir = tmp_path / "temp_exports"
    for d in (db_dir, upload_dir, output_dir, temp_dir):
        d.mkdir(parents=True, exist_ok=True)

    db_url = f"sqlite:///{(db_dir / 'test_reef.db').as_posix()}"

    monkeypatch.setattr(config, "DB_DIR", db_dir)
    monkeypatch.setattr(config, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(config, "OUTPUT_DIR", output_dir)
    monkeypatch.setattr(config, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(config, "DATABASE_URL", db_url)

    import routes
    import utils

    monkeypatch.setattr(routes, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(routes, "OUTPUT_DIR", output_dir)
    monkeypatch.setattr(routes, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(app_main, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(app_main, "OUTPUT_DIR", output_dir)

    test_engine = database.create_engine(db_url, connect_args={"check_same_thread": False}, future=True)

    @database.event.listens_for(test_engine, "connect")
    def _fk(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    TestSession = database.sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

    monkeypatch.setattr(database, "engine", test_engine)
    monkeypatch.setattr(database, "SessionLocal", TestSession)
    monkeypatch.setattr(routes, "SessionLocal", TestSession)

    import models  # noqa: F401
    database.Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app_main.app.dependency_overrides[database.get_db] = override_get_db

    with TestClient(app_main.app) as client:
        yield client, upload_dir, output_dir, db_dir

    app_main.app.dependency_overrides.clear()
    test_engine.dispose()


def _make_sample_png_bytes(width=160, height=120, color_shift=0) -> bytes:
    """Create a realistic synthetic underwater coral/fish pattern image."""
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    y_grad = np.linspace(40, 180, height, dtype=np.uint8)[:, None]
    x_grad = np.linspace(30, 210, width, dtype=np.uint8)[None, :]
    arr[:, :, 0] = np.clip((x_grad // 2 + color_shift) % 255, 0, 255)
    arr[:, :, 1] = np.clip((y_grad + 40) % 255, 0, 255)
    arr[:, :, 2] = 190
    # Draw distinct non-symmetric bright fish shape so flips/rotations/crops visibly change pixels
    arr[25:55, 30:75] = [250, 120, 40]
    arr[35:45, 75:90] = [255, 220, 60]
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


def test_health_and_empty_dashboard(isolated_env):
    client, *_ = isolated_env
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["database"] == "connected"
    assert body["techniques_count"] == 15

    dash = client.get("/api/dashboard")
    assert dash.status_code == 200
    d = dash.json()
    assert d["total_uploaded_images"] == 0
    assert d["total_augmented_images"] == 0
    assert d["total_processing_jobs"] == 0
    assert d["total_techniques"] == 15


def test_single_multi_and_invalid_uploads(isolated_env):
    client, upload_dir, *_ = isolated_env

    # Single valid upload
    r1 = client.post(
        "/api/upload",
        files=[("files", ("clownfish.png", _make_sample_png_bytes(), "image/png"))],
    )
    assert r1.status_code == 201
    uploaded1 = r1.json()["uploaded"]
    assert len(uploaded1) == 1
    assert uploaded1[0]["original_filename"] == "clownfish.png"
    assert uploaded1[0]["width"] == 160
    assert uploaded1[0]["height"] == 120
    assert (upload_dir / uploaded1[0]["stored_filename"]).exists()

    # Multiple valid uploads
    r2 = client.post(
        "/api/upload",
        files=[
            ("files", ("reef_a.png", _make_sample_png_bytes(140, 100, 10), "image/png")),
            ("files", ("reef_b.png", _make_sample_png_bytes(180, 120, 40), "image/png")),
        ],
    )
    assert r2.status_code == 201
    assert len(r2.json()["uploaded"]) == 2

    # Invalid file extension
    r_bad_ext = client.post(
        "/api/upload",
        files=[("files", ("malware.exe", b"MZ-fake", "application/octet-stream"))],
    )
    assert r_bad_ext.status_code == 400

    # Invalid corrupted image bytes with valid extension
    r_corrupt = client.post(
        "/api/upload",
        files=[("files", ("corrupt.png", b"not-a-real-png", "image/png"))],
    )
    assert r_corrupt.status_code == 400


def test_all_15_techniques_and_param_validation(isolated_env):
    client, upload_dir, output_dir, _ = isolated_env

    orig_bytes = _make_sample_png_bytes(200, 150)
    up = client.post(
        "/api/upload",
        files=[("files", ("turtle.png", orig_bytes, "image/png"))],
    ).json()["uploaded"][0]
    image_id = up["id"]
    orig_arr = np.array(Image.open(upload_dir / up["stored_filename"]).convert("RGB"))

    techs = client.get("/api/techniques").json()
    assert len(techs) == 15

    # Test parameter validation rejection
    bad_param = client.post(
        "/api/augment",
        json={"image_id": image_id, "technique": "rotation", "parameters": {"angle": 999}},
    )
    assert bad_param.status_code == 400

    bad_tech = client.post(
        "/api/augment",
        json={"image_id": image_id, "technique": "nonexistent_fx", "parameters": {}},
    )
    assert bad_tech.status_code == 400

    # Test every single one of the 15 techniques produces a distinct real image
    for tech in techs:
        key = tech["key"]
        params = {p["name"]: p["default"] for p in tech["parameters"]}
        if key == "resize":
            params = {"width": 120, "height": 90, "preserve_aspect_ratio": True}

        resp = client.post(
            "/api/augment",
            json={
                "image_id": image_id,
                "technique": key,
                "parameters": params,
                "save_to_gallery": True,
            },
        )
        assert resp.status_code == 200, f"Technique {key} failed: {resp.text}"
        out_meta = resp.json()
        out_path = output_dir / out_meta["output_filename"]
        assert out_path.exists()
        out_arr = np.array(Image.open(out_path).convert("RGB"))

        if key == "resize":
            assert out_arr.shape[:2] != orig_arr.shape[:2]
        else:
            assert not np.array_equal(orig_arr, out_arr), f"{key} produced identical pixels!"

    # Test preview-only mode does not add to gallery
    gallery_before = client.get("/api/results").json()["total"]
    preview_res = client.post(
        "/api/augment",
        json={
            "image_id": image_id,
            "technique": "underwater_haze",
            "parameters": {"intensity": 0.5, "tint": "teal", "depth_gradient": True},
            "save_to_gallery": False,
        },
    )
    assert preview_res.status_code == 200
    assert preview_res.json()["preview_data_url"].startswith("data:image/png;base64,")
    assert client.get("/api/results").json()["total"] == gallery_before

    # Test sequential pipeline
    pipe_res = client.post(
        "/api/augment",
        json={
            "image_id": image_id,
            "steps": [
                {"technique": "horizontal_flip", "parameters": {}},
                {"technique": "brightness", "parameters": {"factor": 0.2}},
                {"technique": "underwater_particles", "parameters": {"density": 0.4, "intensity": 0.7, "particle_size": 3}},
            ],
            "save_to_gallery": True,
        },
    )
    assert pipe_res.status_code == 200
    assert pipe_res.json()["technique"] == "horizontal_flip+brightness+underwater_particles"


def test_batch_gallery_comparison_zip_summary_history_and_safe_delete(isolated_env):
    client, upload_dir, output_dir, _ = isolated_env

    # Upload 2 images
    up = client.post(
        "/api/upload",
        files=[
            ("files", ("coral1.png", _make_sample_png_bytes(160, 120, 5), "image/png")),
            ("files", ("coral2.png", _make_sample_png_bytes(160, 120, 55), "image/png")),
        ],
    ).json()["uploaded"]
    ids = [u["id"] for u in up]

    # Run batch: 2 images x 2 techniques x 2 variations = 8 expected outputs
    batch_res = client.post(
        "/api/batch",
        json={
            "image_ids": ids,
            "techniques": ["horizontal_flip", "underwater_haze"],
            "variations_per_technique": 2,
            "technique_parameters": {
                "underwater_haze": {"intensity": 0.45, "tint": "teal", "depth_gradient": True}
            },
        },
    )
    assert batch_res.status_code == 202
    job_id = batch_res.json()["id"]

    status_res = client.get(f"/api/batch/{job_id}/status").json()
    assert status_res["status"] == "completed"
    assert status_res["total_images"] == 8
    assert status_res["completed_images"] == 8
    assert status_res["failed_images"] == 0
    assert len(status_res["items"]) == 8

    # Gallery filtering & sorting
    gallery = client.get("/api/results?technique=underwater_haze&sort=newest").json()
    assert gallery["total"] == 4
    first_result_id = gallery["items"][0]["id"]

    # Comparison endpoint
    comp = client.get(f"/api/comparison/{ids[0]}").json()
    assert comp["original"]["id"] == ids[0]
    assert len(comp["results"]) == 4

    # Summary & charts
    summary = client.get("/api/summary").json()
    assert summary["total_original_images"] == 2
    assert summary["total_generated_images"] == 8
    assert summary["successful_jobs"] == 1
    assert summary["techniques_used_count"] == 2

    charts = client.get("/api/summary/charts").json()
    assert len(charts["technique_distribution"]) == 2
    assert len(charts["format_distribution"]) == 1

    # ZIP export & manifest inspection
    zip_resp = client.get("/api/export/zip")
    assert zip_resp.status_code == 200
    assert zip_resp.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert all(not n.endswith(".db") and not n.startswith("..") for n in names)
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert manifest["total_images"] == 8
        assert len(manifest["items"]) == 8

    # Batch-specific ZIP export
    bzip_resp = client.get(f"/api/batch/{job_id}/download")
    assert bzip_resp.status_code == 200

    # Safe deletion: deleting an augmented result MUST NOT delete original uploaded file
    orig_file = upload_dir / up[0]["stored_filename"]
    assert orig_file.exists()
    del_res = client.delete(f"/api/results/{first_result_id}")
    assert del_res.status_code == 200
    assert orig_file.exists()

    # History search & deletion
    hist = client.get("/api/history?status=success").json()
    assert hist["total"] == 8
    hist_id = hist["items"][0]["id"]
    del_hist = client.delete(f"/api/history/{hist_id}")
    assert del_hist.status_code == 200
    assert orig_file.exists()



def test_batch_partial_failure_and_retry(isolated_env):
    client, upload_dir, *_ = isolated_env

    up = client.post(
        "/api/upload",
        files=[
            ("files", ("good.png", _make_sample_png_bytes(120, 90, 10), "image/png")),
            ("files", ("flaky.png", _make_sample_png_bytes(120, 90, 20), "image/png")),
        ],
    ).json()["uploaded"]

    # Temporarily remove flaky.png from disk to simulate a single-image failure inside batch
    flaky_path = upload_dir / up[1]["stored_filename"]
    flaky_backup = flaky_path.read_bytes()
    flaky_path.unlink()

    batch_res = client.post(
        "/api/batch",
        json={
            "image_ids": [up[0]["id"], up[1]["id"]],
            "techniques": ["horizontal_flip"],
            "variations_per_technique": 1,
        },
    )
    assert batch_res.status_code == 202
    job_id = batch_res.json()["id"]

    status_res = client.get(f"/api/batch/{job_id}/status").json()
    assert status_res["status"] == "completed_with_errors"
    assert status_res["completed_images"] == 1
    assert status_res["failed_images"] == 1

    # Restore flaky.png and retry failed items
    flaky_path.write_bytes(flaky_backup)
    retry_res = client.post(f"/api/batch/{job_id}/retry")
    assert retry_res.status_code == 200
    retried = retry_res.json()
    assert retried["status"] == "completed"
    assert retried["completed_images"] == 2
    assert retried["failed_images"] == 0


def test_path_traversal_guard_and_sqlite_persistence(isolated_env):
    client, _, _, db_dir = isolated_env
    import utils

    with pytest.raises(ValueError):
        utils.resolve_safe_path(db_dir, "../database/reefaugment.db")

    # Upload & augment, then verify records exist in a brand-new SQLAlchemy session against the same SQLite DB
    up = client.post(
        "/api/upload",
        files=[("files", ("persist.png", _make_sample_png_bytes(), "image/png"))],
    ).json()["uploaded"][0]
    aug = client.post(
        "/api/augment",
        json={
            "image_id": up["id"],
            "technique": "brightness",
            "parameters": {"factor": 0.25},
            "save_to_gallery": True,
        },
    )
    assert aug.status_code == 200

    # Re-open fresh engine pointing to the exact same SQLite database file
    db_file = db_dir / "test_reef.db"
    assert db_file.exists()
    fresh_engine = database.create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    FreshSession = database.sessionmaker(autocommit=False, autoflush=False, bind=fresh_engine)
    import models
    with FreshSession() as session:
        assert session.query(models.UploadedImage).count() == 1
        assert session.query(models.AugmentationResult).count() == 1
        assert session.query(models.ProcessingHistory).count() == 1
    fresh_engine.dispose()
