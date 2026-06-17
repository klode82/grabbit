from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path


def _log_path() -> Path:
    """Return the path to GRABBIT's log file, creating the directory if needed."""
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        base = Path(xdg)
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path.home() / ".config"
    log_dir = base / "grabbit"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "grabbit.log"


def setup_logger(debug: bool = False) -> logging.Logger:
    """Configure and return the root GRABBIT logger.

    Writes DEBUG+ to a rotating log file (5 MB × 3 backups).
    Writes WARNING+ to the terminal unless *debug* is True,
    in which case DEBUG is printed to the terminal as well.
    """
    logger = logging.getLogger("grabbit")

    # Avoid adding duplicate handlers if called more than once
    if logger.handlers:
        return logger

    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)-8s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotating file handler — always active
    fh = RotatingFileHandler(
        _log_path(), maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    # Console handler — WARNING by default, DEBUG in debug mode
    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG if debug else logging.WARNING)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    return logger


def get_log_path() -> str:
    """Return the absolute path to the log file as a string."""
    return str(_log_path())


# Module-level logger — import this in other modules:
#   from app.core.logger import log
log = setup_logger()
