"""SQLAlchemy ORM models for ReefAugment AI."""

from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


def utc_now() -> datetime:
    """Return timezone-naive UTC datetime compatible with SQLite storage."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class UploadedImage(Base):
    """Metadata for an original uploaded underwater species image."""

    __tablename__ = "uploaded_images"

    id = Column(Integer, primary_key=True, index=True)
    original_filename = Column(String(255), nullable=False)
    stored_filename = Column(String(255), nullable=False, unique=True, index=True)
    file_path = Column(String(512), nullable=False)
    file_format = Column(String(20), nullable=False)
    file_size = Column(Integer, nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime, default=utc_now, nullable=False)

    augmentation_results = relationship(
        "AugmentationResult",
        back_populates="original_image",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    history_entries = relationship(
        "ProcessingHistory",
        back_populates="original_image",
        passive_deletes=True,
    )


class ProcessingJob(Base):
    """Tracks single, sequential pipeline, and batch augmentation jobs."""

    __tablename__ = "processing_jobs"

    id = Column(Integer, primary_key=True, index=True)
    job_type = Column(String(32), nullable=False, default="single")
    status = Column(String(32), nullable=False, default="pending", index=True)
    total_images = Column(Integer, nullable=False, default=0)
    completed_images = Column(Integer, nullable=False, default=0)
    failed_images = Column(Integer, nullable=False, default=0)
    config_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    results = relationship(
        "AugmentationResult",
        back_populates="job",
        passive_deletes=True,
    )
    history_entries = relationship(
        "ProcessingHistory",
        back_populates="job",
        passive_deletes=True,
    )


class AugmentationResult(Base):
    """Metadata for a generated augmented output image."""

    __tablename__ = "augmentation_results"

    id = Column(Integer, primary_key=True, index=True)
    original_image_id = Column(
        Integer,
        ForeignKey("uploaded_images.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_id = Column(
        Integer,
        ForeignKey("processing_jobs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    output_filename = Column(String(255), nullable=False, unique=True, index=True)
    output_path = Column(String(512), nullable=False)
    technique = Column(String(120), nullable=False, index=True)
    parameters = Column(JSON, nullable=False, default=dict)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)
    file_size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False, index=True)

    original_image = relationship("UploadedImage", back_populates="augmentation_results")
    job = relationship("ProcessingJob", back_populates="results")
    history_entries = relationship(
        "ProcessingHistory",
        back_populates="result",
        passive_deletes=True,
    )


class ProcessingHistory(Base):
    """Persistent audit log of all image augmentation executions."""

    __tablename__ = "processing_history"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(
        Integer,
        ForeignKey("processing_jobs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    original_image_id = Column(
        Integer,
        ForeignKey("uploaded_images.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    result_id = Column(
        Integer,
        ForeignKey("augmentation_results.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    original_filename = Column(String(255), nullable=False)
    output_filename = Column(String(255), nullable=True)
    technique = Column(String(120), nullable=False, index=True)
    parameters = Column(JSON, nullable=False, default=dict)
    status = Column(String(32), nullable=False, index=True)
    created_at = Column(DateTime, default=utc_now, nullable=False, index=True)
    error_message = Column(Text, nullable=True)

    job = relationship("ProcessingJob", back_populates="history_entries")
    original_image = relationship("UploadedImage", back_populates="history_entries")
    result = relationship("AugmentationResult", back_populates="history_entries")
