"""Physics-inspired underwater image effects (haze & suspended particles)."""

from typing import Optional

import cv2
import numpy as np

HAZE_TINTS = {
    "teal": np.array([18.0, 128.0, 146.0], dtype=np.float32),
    "deep_blue": np.array([14.0, 72.0, 142.0], dtype=np.float32),
    "green_murk": np.array([26.0, 118.0, 88.0], dtype=np.float32),
}


def apply_underwater_haze(
    image: np.ndarray,
    intensity: float = 0.45,
    tint: str = "teal",
    depth_gradient: bool = True,
    seed: Optional[int] = None,
) -> np.ndarray:
    """Simulate underwater light attenuation, scattering haze, and turbidity.

    Args:
        image: RGB uint8 image array of shape (H, W, 3).
        intensity: Haze strength in [0.05, 0.90].
        tint: Water column color profile ('teal', 'deep_blue', or 'green_murk').
        depth_gradient: Whether haze increases slightly across vertical depth.
        seed: Optional random seed for deterministic spatial turbidity variation.

    Returns:
        Transformed RGB uint8 image array.
    """
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Expected an RGB image with shape (H, W, 3).")

    if not (0.05 <= intensity <= 0.90):
        raise ValueError("Haze intensity must be between 0.05 and 0.90.")

    if tint not in HAZE_TINTS:
        raise ValueError(f"Unsupported haze tint '{tint}'. Must be one of {list(HAZE_TINTS)}.")

    rng = np.random.default_rng(seed)
    h, w, _ = image.shape
    img_float = image.astype(np.float32)

    # Wavelength-dependent attenuation: red attenuates faster underwater than green/blue
    channel_attenuation = np.array(
        [
            1.0 - 0.55 * intensity,
            1.0 - 0.16 * intensity,
            1.0 - 0.04 * intensity,
        ],
        dtype=np.float32,
    )
    attenuated = img_float * channel_attenuation[None, None, :]

    # Slight soft-focus forward scattering blur for realistic turbidity
    if intensity >= 0.15:
        ksize = max(3, int(round(3 + intensity * 8)) | 1)
        turbid = cv2.GaussianBlur(attenuated, (ksize, ksize), sigmaX=intensity * 1.8)
        attenuated = cv2.addWeighted(attenuated, 1.0 - 0.35 * intensity, turbid, 0.35 * intensity, 0.0)

    # Build smooth spatially varying transmission map t(y, x)
    base_transmission = 1.0 - (0.72 * intensity)
    if depth_gradient:
        vertical_profile = np.linspace(0.08 * intensity, -0.10 * intensity, h, dtype=np.float32)[:, None]
    else:
        vertical_profile = np.zeros((h, 1), dtype=np.float32)

    # Low-frequency turbidity cloud field
    coarse_h = max(4, h // 48)
    coarse_w = max(4, w // 48)
    coarse_noise = rng.uniform(-0.08 * intensity, 0.08 * intensity, size=(coarse_h, coarse_w)).astype(np.float32)
    smooth_noise = cv2.resize(coarse_noise, (w, h), interpolation=cv2.INTER_CUBIC)

    transmission = np.clip(base_transmission + vertical_profile + smooth_noise, 0.08, 0.96)
    transmission_3c = transmission[:, :, None]

    veil_color = HAZE_TINTS[tint][None, None, :]
    hazed = attenuated * transmission_3c + veil_color * (1.0 - transmission_3c)

    return np.clip(hazed, 0, 255).astype(np.uint8)


def apply_underwater_particles(
    image: np.ndarray,
    density: float = 0.40,
    intensity: float = 0.65,
    particle_size: int = 3,
    seed: Optional[int] = None,
) -> np.ndarray:
    """Add suspended underwater marine snow, plankton specks, and micro-bubbles.

    Args:
        image: RGB uint8 image array of shape (H, W, 3).
        density: Particle coverage density in [0.05, 1.0].
        intensity: Brightness/opacity of particles in [0.10, 1.0].
        particle_size: Base radius scale in pixels [1, 8].
        seed: Optional random seed for reproducibility.

    Returns:
        Transformed RGB uint8 image array.
    """
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Expected an RGB image with shape (H, W, 3).")

    if not (0.05 <= density <= 1.0):
        raise ValueError("Particle density must be between 0.05 and 1.0.")
    if not (0.10 <= intensity <= 1.0):
        raise ValueError("Particle intensity must be between 0.10 and 1.0.")
    if not (1 <= int(particle_size) <= 8):
        raise ValueError("Particle size must be an integer between 1 and 8.")

    rng = np.random.default_rng(seed)
    h, w, _ = image.shape
    base = image.astype(np.float32)

    # Scale count proportionally to image area while clamping for performance
    num_particles = int(np.clip((h * w / 2800.0) * density, 25, 1800))

    far_layer = np.zeros((h, w, 3), dtype=np.float32)
    far_alpha = np.zeros((h, w), dtype=np.float32)
    near_layer = np.zeros((h, w, 3), dtype=np.float32)
    near_alpha = np.zeros((h, w), dtype=np.float32)

    for idx in range(num_particles):
        cx = int(rng.integers(0, w))
        cy = int(rng.integers(0, h))
        is_near = (idx % 4 == 0)

        # Subtle off-white / aqua backscatter color variation
        color = (
            float(rng.uniform(205, 245)),
            float(rng.uniform(225, 252)),
            float(rng.uniform(230, 255)),
        )

        if is_near:
            radius = max(1, int(rng.integers(max(1, particle_size), particle_size * 2 + 2)))
            alpha_val = float(rng.uniform(0.28, 0.72) * intensity)
            cv2.circle(near_layer, (cx, cy), radius, color, thickness=-1, lineType=cv2.LINE_AA)
            cv2.circle(near_alpha, (cx, cy), radius, alpha_val, thickness=-1, lineType=cv2.LINE_AA)
        else:
            radius = max(1, int(rng.integers(1, max(2, particle_size + 1))))
            alpha_val = float(rng.uniform(0.18, 0.55) * intensity)
            # Some particles have slight water-current drift elongation
            if rng.random() < 0.35:
                dx = int(rng.integers(-radius - 2, radius + 3))
                dy = int(rng.integers(-1, 2))
                cv2.line(far_layer, (cx, cy), (cx + dx, cy + dy), color, thickness=max(1, radius // 2), lineType=cv2.LINE_AA)
                cv2.line(far_alpha, (cx, cy), (cx + dx, cy + dy), alpha_val, thickness=max(1, radius // 2), lineType=cv2.LINE_AA)
            else:
                cv2.circle(far_layer, (cx, cy), radius, color, thickness=-1, lineType=cv2.LINE_AA)
                cv2.circle(far_alpha, (cx, cy), radius, alpha_val, thickness=-1, lineType=cv2.LINE_AA)

    # Soft bokeh blur on near out-of-focus specks, gentle smoothing on far specks
    far_blur_k = max(3, (particle_size * 2 + 1) | 1)
    near_blur_k = max(5, (particle_size * 4 + 1) | 1)

    far_layer = cv2.GaussianBlur(far_layer, (far_blur_k, far_blur_k), sigmaX=0.9)
    far_alpha = cv2.GaussianBlur(far_alpha, (far_blur_k, far_blur_k), sigmaX=0.9)

    near_layer = cv2.GaussianBlur(near_layer, (near_blur_k, near_blur_k), sigmaX=1.8)
    near_alpha = cv2.GaussianBlur(near_alpha, (near_blur_k, near_blur_k), sigmaX=1.8)

    combined_alpha = np.clip(far_alpha + near_alpha, 0.0, 0.85)[:, :, None]
    combined_particles = np.clip(far_layer * 0.55 + near_layer * 0.65, 0.0, 255.0)

    # Composite with gentle screen-like highlight boost for underwater backscatter
    blended = base * (1.0 - combined_alpha) + np.maximum(base, combined_particles) * combined_alpha
    return np.clip(blended, 0, 255).astype(np.uint8)
