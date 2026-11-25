"""Core 15 underwater & computer-vision augmentation techniques for ReefAugment AI."""

import os

os.environ.setdefault("NO_ALBUMENTATIONS_UPDATE", "1")

from typing import Any, Dict, List, Optional, Tuple

import albumentations as A
import cv2
import numpy as np
from PIL import Image, ImageOps

from underwater_effects import apply_underwater_haze, apply_underwater_particles

TECHNIQUE_CATALOG: List[Dict[str, Any]] = [
    {
        "key": "horizontal_flip",
        "name": "Horizontal Flip",
        "category": "Geometric",
        "description": "Mirrors the underwater image from left to right to balance directional species poses.",
        "parameters": [],
    },
    {
        "key": "vertical_flip",
        "name": "Vertical Flip",
        "category": "Geometric",
        "description": "Flips the image vertically to increase orientation diversity for benthic and reef taxa.",
        "parameters": [],
    },
    {
        "key": "rotation",
        "name": "Rotation",
        "category": "Geometric",
        "description": "Rotates the image by a configurable angle with clean border reflection or padding.",
        "parameters": [
            {
                "name": "angle",
                "label": "Rotation Angle (deg)",
                "type": "float",
                "default": 25.0,
                "min": -180.0,
                "max": 180.0,
                "step": 1.0,
                "description": "Counter-clockwise rotation angle in degrees.",
            },
            {
                "name": "border_mode",
                "label": "Border Mode",
                "type": "select",
                "default": "reflect",
                "options": ["reflect", "constant"],
                "description": "How empty edges outside the rotated frame are filled.",
            },
        ],
    },
    {
        "key": "zoom_crop",
        "name": "Zoom & Crop",
        "category": "Geometric",
        "description": "Zooms into a focused underwater region and crops around the chosen center.",
        "parameters": [
            {
                "name": "zoom_factor",
                "label": "Zoom Factor",
                "type": "float",
                "default": 1.5,
                "min": 1.05,
                "max": 3.0,
                "step": 0.05,
                "description": "Magnification factor (higher values crop tighter).",
            },
            {
                "name": "center_x",
                "label": "Horizontal Focus",
                "type": "float",
                "default": 0.5,
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "description": "Normalized horizontal crop center (0=left, 1=right).",
            },
            {
                "name": "center_y",
                "label": "Vertical Focus",
                "type": "float",
                "default": 0.5,
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "description": "Normalized vertical crop center (0=top, 1=bottom).",
            },
            {
                "name": "keep_original_size",
                "label": "Restore Original Dimensions",
                "type": "bool",
                "default": True,
                "description": "Resize zoomed crop back to original resolution.",
            },
        ],
    },
    {
        "key": "resize",
        "name": "Resize",
        "category": "Geometric",
        "description": "Resizes images to target dimensions, optionally preserving aspect ratio.",
        "parameters": [
            {
                "name": "width",
                "label": "Target Width (px)",
                "type": "int",
                "default": 640,
                "min": 64,
                "max": 4096,
                "step": 16,
                "description": "Desired output width in pixels.",
            },
            {
                "name": "height",
                "label": "Target Height (px)",
                "type": "int",
                "default": 480,
                "min": 64,
                "max": 4096,
                "step": 16,
                "description": "Desired output height in pixels.",
            },
            {
                "name": "preserve_aspect_ratio",
                "label": "Preserve Aspect Ratio",
                "type": "bool",
                "default": True,
                "description": "Fit within width x height while keeping original proportions.",
            },
        ],
    },
    {
        "key": "brightness",
        "name": "Brightness Adjustment",
        "category": "Color & Lighting",
        "description": "Simulates brighter shallow sunlit reefs or darker deep-water environments.",
        "parameters": [
            {
                "name": "factor",
                "label": "Brightness Offset",
                "type": "float",
                "default": 0.25,
                "min": -0.8,
                "max": 0.8,
                "step": 0.05,
                "description": "Negative values darken; positive values brighten.",
            },
        ],
    },
    {
        "key": "contrast",
        "name": "Contrast Adjustment",
        "category": "Color & Lighting",
        "description": "Adjusts tonal separation to counter low-contrast underwater scenes.",
        "parameters": [
            {
                "name": "factor",
                "label": "Contrast Multiplier",
                "type": "float",
                "default": 1.4,
                "min": 0.2,
                "max": 2.5,
                "step": 0.05,
                "description": "Values < 1 flatten contrast; values > 1 sharpen tonal separation.",
            },
        ],
    },
    {
        "key": "saturation",
        "name": "Saturation Adjustment",
        "category": "Color & Lighting",
        "description": "Modifies color richness to simulate depth-dependent color loss or restoration.",
        "parameters": [
            {
                "name": "factor",
                "label": "Saturation Multiplier",
                "type": "float",
                "default": 1.5,
                "min": 0.0,
                "max": 2.5,
                "step": 0.05,
                "description": "0 removes color; 1 preserves original; >1 increases vibrancy.",
            },
        ],
    },
    {
        "key": "hue",
        "name": "Hue Adjustment",
        "category": "Color & Lighting",
        "description": "Shifts color hue to model varying water-column blue/green/cyan lighting.",
        "parameters": [
            {
                "name": "shift",
                "label": "Hue Shift (deg)",
                "type": "int",
                "default": 25,
                "min": -180,
                "max": 180,
                "step": 5,
                "description": "Hue wheel shift in degrees.",
            },
        ],
    },
    {
        "key": "noise",
        "name": "Noise Addition",
        "category": "Sensor & Optics",
        "description": "Adds configurable camera sensor noise common in low-light underwater capture.",
        "parameters": [
            {
                "name": "intensity",
                "label": "Noise Intensity",
                "type": "float",
                "default": 0.08,
                "min": 0.01,
                "max": 0.5,
                "step": 0.01,
                "description": "Standard deviation / strength of injected noise.",
            },
            {
                "name": "noise_type",
                "label": "Noise Profile",
                "type": "select",
                "default": "gaussian",
                "options": ["gaussian", "speckle"],
                "description": "Additive Gaussian sensor noise or multiplicative speckle noise.",
            },
        ],
    },
    {
        "key": "blur",
        "name": "Blur",
        "category": "Sensor & Optics",
        "description": "Applies Gaussian optical blur to emulate camera defocus or water motion.",
        "parameters": [
            {
                "name": "intensity",
                "label": "Blur Radius",
                "type": "int",
                "default": 5,
                "min": 1,
                "max": 25,
                "step": 1,
                "description": "Kernel radius (higher values produce stronger blur).",
            },
        ],
    },
    {
        "key": "underwater_haze",
        "name": "Underwater Haze",
        "category": "Underwater Physics",
        "description": "Simulates underwater light attenuation, scattering veil, and reduced visibility.",
        "parameters": [
            {
                "name": "intensity",
                "label": "Haze Intensity",
                "type": "float",
                "default": 0.45,
                "min": 0.05,
                "max": 0.9,
                "step": 0.05,
                "description": "Strength of water-column scattering and visibility loss.",
            },
            {
                "name": "tint",
                "label": "Water Column Tint",
                "type": "select",
                "default": "teal",
                "options": ["teal", "deep_blue", "green_murk"],
                "description": "Simulated marine water optical tint.",
            },
            {
                "name": "depth_gradient",
                "label": "Depth Gradient",
                "type": "bool",
                "default": True,
                "description": "Apply subtle vertical haze progression across frame depth.",
            },
        ],
    },
    {
        "key": "underwater_particles",
        "name": "Underwater Particles",
        "category": "Underwater Physics",
        "description": "Synthesizes suspended marine snow, plankton specks, and micro-bubbles.",
        "parameters": [
            {
                "name": "density",
                "label": "Particle Density",
                "type": "float",
                "default": 0.4,
                "min": 0.05,
                "max": 1.0,
                "step": 0.05,
                "description": "Spatial concentration of suspended particles.",
            },
            {
                "name": "intensity",
                "label": "Particle Brightness",
                "type": "float",
                "default": 0.65,
                "min": 0.1,
                "max": 1.0,
                "step": 0.05,
                "description": "Backscatter opacity of suspended specks.",
            },
            {
                "name": "particle_size",
                "label": "Particle Size (px)",
                "type": "int",
                "default": 3,
                "min": 1,
                "max": 8,
                "step": 1,
                "description": "Base radius of marine snow particles.",
            },
        ],
    },
    {
        "key": "perspective",
        "name": "Perspective Transformation",
        "category": "Deformation",
        "description": "Applies controlled 4-point perspective warp to simulate diver camera angle changes.",
        "parameters": [
            {
                "name": "scale",
                "label": "Warp Scale",
                "type": "float",
                "default": 0.10,
                "min": 0.02,
                "max": 0.25,
                "step": 0.01,
                "description": "Maximum normalized corner shift.",
            },
            {
                "name": "direction",
                "label": "Tilt Direction",
                "type": "select",
                "default": "random",
                "options": ["random", "left", "right", "top", "bottom"],
                "description": "Camera tilt direction or randomized quad warp.",
            },
        ],
    },
    {
        "key": "elastic",
        "name": "Elastic Transformation",
        "category": "Deformation",
        "description": "Applies gentle water-refraction style elastic deformation without tearing subjects.",
        "parameters": [
            {
                "name": "alpha",
                "label": "Displacement Strength (Alpha)",
                "type": "float",
                "default": 30.0,
                "min": 5.0,
                "max": 80.0,
                "step": 1.0,
                "description": "Magnitude of local elastic wave displacement.",
            },
            {
                "name": "sigma",
                "label": "Smoothness (Sigma)",
                "type": "float",
                "default": 6.0,
                "min": 3.0,
                "max": 15.0,
                "step": 0.5,
                "description": "Gaussian smoothing scale preventing excessive distortion.",
            },
        ],
    },
]

TECHNIQUE_MAP: Dict[str, Dict[str, Any]] = {item["key"]: item for item in TECHNIQUE_CATALOG}


def get_technique_label(technique_key: str) -> str:
    """Return human-readable label for a technique or pipeline key."""
    if technique_key in TECHNIQUE_MAP:
        return TECHNIQUE_MAP[technique_key]["name"]
    if "+" in technique_key:
        parts = [get_technique_label(part.strip()) for part in technique_key.split("+")]
        return " -> ".join(parts)
    return technique_key.replace("_", " ").title()


def validate_and_normalize_params(
    technique_key: str,
    raw_params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Validate parameter types/bounds against TECHNIQUE_CATALOG and fill defaults."""
    if technique_key not in TECHNIQUE_MAP:
        raise ValueError(f"Unknown augmentation technique '{technique_key}'.")

    meta = TECHNIQUE_MAP[technique_key]
    provided = raw_params or {}
    normalized: Dict[str, Any] = {}

    for spec in meta["parameters"]:
        name = spec["name"]
        param_type = spec["type"]
        val = provided.get(name, spec["default"])

        if param_type == "float":
            try:
                num = float(val)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Parameter '{name}' must be a valid number.") from exc
            if spec.get("min") is not None and num < spec["min"]:
                raise ValueError(f"Parameter '{name}' must be >= {spec['min']}.")
            if spec.get("max") is not None and num > spec["max"]:
                raise ValueError(f"Parameter '{name}' must be <= {spec['max']}.")
            normalized[name] = round(num, 4)

        elif param_type == "int":
            if isinstance(val, bool):
                raise ValueError(f"Parameter '{name}' must be an integer.")
            try:
                num_int = int(round(float(val)))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Parameter '{name}' must be an integer.") from exc
            if spec.get("min") is not None and num_int < int(spec["min"]):
                raise ValueError(f"Parameter '{name}' must be >= {int(spec['min'])}.")
            if spec.get("max") is not None and num_int > int(spec["max"]):
                raise ValueError(f"Parameter '{name}' must be <= {int(spec['max'])}.")
            normalized[name] = num_int

        elif param_type == "bool":
            if isinstance(val, bool):
                normalized[name] = val
            elif isinstance(val, str):
                lowered = val.strip().lower()
                if lowered in {"true", "1", "yes"}:
                    normalized[name] = True
                elif lowered in {"false", "0", "no"}:
                    normalized[name] = False
                else:
                    raise ValueError(f"Parameter '{name}' must be a boolean.")
            else:
                normalized[name] = bool(val)

        elif param_type == "select":
            str_val = str(val)
            options = spec.get("options") or []
            if str_val not in options:
                raise ValueError(f"Parameter '{name}' must be one of {options}.")
            normalized[name] = str_val

    return normalized


def load_rgb_image(image_path) -> np.ndarray:
    """Load an image file safely into an RGB uint8 numpy array with EXIF orientation."""
    with Image.open(image_path) as img:
        transposed = ImageOps.exif_transpose(img)
        rgb = transposed.convert("RGB")
        return np.array(rgb, dtype=np.uint8)


def save_rgb_image(rgb_array: np.ndarray, dest_path, file_format: str = "PNG") -> Tuple[int, int, int]:
    """Save an RGB numpy array to disk and return (width, height, file_size_bytes)."""
    pil_img = Image.fromarray(np.clip(rgb_array, 0, 255).astype(np.uint8), mode="RGB")
    fmt = file_format.upper()
    if fmt == "JPG":
        fmt = "JPEG"
    save_kwargs: Dict[str, Any] = {}
    if fmt in {"JPEG", "WEBP"}:
        save_kwargs["quality"] = 94
    pil_img.save(dest_path, format=fmt, **save_kwargs)
    width, height = pil_img.size
    size_bytes = dest_path.stat().st_size
    return width, height, size_bytes


def apply_single_technique(
    image: np.ndarray,
    technique_key: str,
    raw_params: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Apply one validated augmentation technique and return (result_rgb, normalized_params)."""
    params = validate_and_normalize_params(technique_key, raw_params)
    h, w, _ = image.shape
    rng = np.random.default_rng(seed)

    if technique_key == "horizontal_flip":
        out = A.HorizontalFlip(p=1.0)(image=image)["image"]

    elif technique_key == "vertical_flip":
        out = A.VerticalFlip(p=1.0)(image=image)["image"]

    elif technique_key == "rotation":
        angle = params["angle"]
        bm = cv2.BORDER_REFLECT_101 if params["border_mode"] == "reflect" else cv2.BORDER_CONSTANT
        center = (w / 2.0, h / 2.0)
        matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
        out = cv2.warpAffine(image, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=bm)

    elif technique_key == "zoom_crop":
        zoom = params["zoom_factor"]
        crop_w = min(w, max(4, int(round(w / zoom))))
        crop_h = min(h, max(4, int(round(h / zoom))))
        cx = int(round(params["center_x"] * w))
        cy = int(round(params["center_y"] * h))
        x_min = max(0, min(w - crop_w, cx - crop_w // 2))
        y_min = max(0, min(h - crop_h, cy - crop_h // 2))
        x_max = x_min + crop_w
        y_max = y_min + crop_h
        cropped = A.Crop(x_min=x_min, y_min=y_min, x_max=x_max, y_max=y_max, p=1.0)(image=image)["image"]
        if params["keep_original_size"]:
            out = A.Resize(height=h, width=w, interpolation=cv2.INTER_CUBIC, p=1.0)(image=cropped)["image"]
        else:
            out = cropped

    elif technique_key == "resize":
        target_w = params["width"]
        target_h = params["height"]
        if params["preserve_aspect_ratio"]:
            scale = min(target_w / float(w), target_h / float(h))
            new_w = max(16, int(round(w * scale)))
            new_h = max(16, int(round(h * scale)))
        else:
            new_w = target_w
            new_h = target_h
        interp = cv2.INTER_AREA if (new_w < w or new_h < h) else cv2.INTER_CUBIC
        out = A.Resize(height=new_h, width=new_w, interpolation=interp, p=1.0)(image=image)["image"]

    elif technique_key == "brightness":
        offset = params["factor"] * 255.0
        adjusted = image.astype(np.float32) + offset
        out = np.clip(adjusted, 0, 255).astype(np.uint8)

    elif technique_key == "contrast":
        factor = params["factor"]
        adjusted = (image.astype(np.float32) - 127.5) * factor + 127.5
        out = np.clip(adjusted, 0, 255).astype(np.uint8)

    elif technique_key == "saturation":
        factor = params["factor"]
        hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV).astype(np.float32)
        hsv[:, :, 1] = np.clip(hsv[:, :, 1] * factor, 0, 255)
        out = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)

    elif technique_key == "hue":
        shift_deg = params["shift"]
        # OpenCV Hue channel spans [0, 179] representing 0..358 degrees
        hue_delta = int(round(shift_deg / 2.0))
        hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
        h_chan = hsv[:, :, 0].astype(np.int16)
        hsv[:, :, 0] = ((h_chan + hue_delta) % 180).astype(np.uint8)
        out = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)

    elif technique_key == "noise":
        intensity = params["intensity"]
        noise_type = params["noise_type"]
        img_f = image.astype(np.float32)
        if noise_type == "speckle":
            mult = rng.normal(0.0, intensity, size=image.shape).astype(np.float32)
            noisy = img_f + img_f * mult
        else:
            sigma = intensity * 110.0
            gauss = rng.normal(0.0, sigma, size=image.shape).astype(np.float32)
            noisy = img_f + gauss
        out = np.clip(noisy, 0, 255).astype(np.uint8)

    elif technique_key == "blur":
        ksize = max(3, int(params["intensity"]) * 2 + 1)
        out = A.GaussianBlur(blur_limit=(ksize, ksize), p=1.0)(image=image)["image"]

    elif technique_key == "underwater_haze":
        out = apply_underwater_haze(
            image,
            intensity=params["intensity"],
            tint=params["tint"],
            depth_gradient=params["depth_gradient"],
            seed=seed,
        )

    elif technique_key == "underwater_particles":
        out = apply_underwater_particles(
            image,
            density=params["density"],
            intensity=params["intensity"],
            particle_size=params["particle_size"],
            seed=seed,
        )

    elif technique_key == "perspective":
        scale = params["scale"]
        direction = params["direction"]
        src = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
        dx = w * scale
        dy = h * scale
        if direction == "left":
            dst = np.float32([[dx * 0.4, dy * 0.7], [w - 1, 0], [w - 1, h - 1], [dx * 0.4, h - 1 - dy * 0.7]])
        elif direction == "right":
            dst = np.float32([[0, 0], [w - 1 - dx * 0.4, dy * 0.7], [w - 1 - dx * 0.4, h - 1 - dy * 0.7], [0, h - 1]])
        elif direction == "top":
            dst = np.float32([[dx * 0.8, dy * 0.4], [w - 1 - dx * 0.8, dy * 0.4], [w - 1, h - 1], [0, h - 1]])
        elif direction == "bottom":
            dst = np.float32([[0, 0], [w - 1, 0], [w - 1 - dx * 0.8, h - 1 - dy * 0.4], [dx * 0.8, h - 1 - dy * 0.4]])
        else:
            jitter_x = rng.uniform(0.15, 1.0, size=4) * dx
            jitter_y = rng.uniform(0.15, 1.0, size=4) * dy
            dst = np.float32([
                [jitter_x[0], jitter_y[0]],
                [w - 1 - jitter_x[1], jitter_y[1]],
                [w - 1 - jitter_x[2], h - 1 - jitter_y[2]],
                [jitter_x[3], h - 1 - jitter_y[3]],
            ])
        matrix = cv2.getPerspectiveTransform(src, dst)
        out = cv2.warpPerspective(image, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)

    elif technique_key == "elastic":
        alpha = params["alpha"]
        sigma = max(params["sigma"], alpha / 14.0)  # keep deformation smooth and usable
        dx = rng.uniform(-1.0, 1.0, size=(h, w)).astype(np.float32) * alpha
        dy = rng.uniform(-1.0, 1.0, size=(h, w)).astype(np.float32) * alpha
        ksize = max(3, int(round(sigma * 4)) | 1)
        dx = cv2.GaussianBlur(dx, (ksize, ksize), sigmaX=sigma)
        dy = cv2.GaussianBlur(dy, (ksize, ksize), sigmaX=sigma)
        grid_x, grid_y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
        map_x = np.clip(grid_x + dx, 0, w - 1)
        map_y = np.clip(grid_y + dy, 0, h - 1)
        out = cv2.remap(image, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)

    else:
        raise ValueError(f"Unsupported augmentation technique '{technique_key}'.")

    return out, params


def apply_pipeline(
    image: np.ndarray,
    steps: List[Dict[str, Any]],
    seed: Optional[int] = None,
) -> Tuple[np.ndarray, str, Dict[str, Any]]:
    """Apply one or more compatible augmentation steps sequentially.

    Returns:
        (transformed_rgb, technique_summary_key, normalized_parameters_payload)
    """
    if not steps:
        raise ValueError("At least one augmentation step is required.")

    current = image.copy()
    normalized_steps: List[Dict[str, Any]] = []
    technique_names: List[str] = []

    for idx, step in enumerate(steps):
        tech = step.get("technique")
        raw_params = step.get("parameters") or {}
        step_seed = (seed + idx * 97) if seed is not None else None
        current, norm_params = apply_single_technique(current, tech, raw_params, seed=step_seed)
        technique_names.append(tech)
        normalized_steps.append({"technique": tech, "parameters": norm_params})

    if len(normalized_steps) == 1:
        return current, technique_names[0], normalized_steps[0]["parameters"]

    return current, "+".join(technique_names), {"steps": normalized_steps}
