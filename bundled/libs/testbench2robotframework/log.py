import logging
from logging.handlers import RotatingFileHandler

from .config import Configuration

logger = logging.Logger("iTB2RF", logging.DEBUG)


def setup_logger(config: Configuration):
    if logger.hasHandlers():
        logger.handlers.clear()
    console_handler = logging.StreamHandler()
    console_handler.setLevel(config.loggingConfiguration.console.logLevel)
    console_handler.setFormatter(logging.Formatter(config.loggingConfiguration.console.logFormat))
    logger.addHandler(console_handler)
    file_handler = RotatingFileHandler(
        filename=config.loggingConfiguration.file.fileName,
        mode="a",
        maxBytes=1 * 1024 * 1024,
        backupCount=2,
        encoding="utf_8",
        delay=False,
    )
    file_handler.setLevel(config.loggingConfiguration.file.logLevel)
    file_handler.setFormatter(logging.Formatter(config.loggingConfiguration.file.logFormat))
    logger.addHandler(file_handler)
    logger.propagate = False
