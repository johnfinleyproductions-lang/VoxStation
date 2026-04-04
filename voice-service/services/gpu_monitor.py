"""
GPU Monitor
===========
Track VRAM usage across VoxStation services.
"""

import logging
from typing import Optional

logger = logging.getLogger("voxstation.gpu")


def get_gpu_info() -> Optional[dict]:
    """Get current GPU memory usage."""
    try:
        import torch

        if not torch.cuda.is_available():
            return None

        device = torch.cuda.current_device()
        total = torch.cuda.get_device_properties(device).total_mem
        allocated = torch.cuda.memory_allocated(device)
        reserved = torch.cuda.memory_reserved(device)
        free = total - reserved

        return {
            "device_name": torch.cuda.get_device_name(device),
            "total_mb": round(total / 1024 / 1024),
            "allocated_mb": round(allocated / 1024 / 1024),
            "reserved_mb": round(reserved / 1024 / 1024),
            "free_mb": round(free / 1024 / 1024),
            "utilization_pct": round(allocated / total * 100, 1),
        }
    except Exception as e:
        logger.warning("Failed to get GPU info: %s", e)
        return None
