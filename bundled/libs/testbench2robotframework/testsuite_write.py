import os
import re
import shutil
from pathlib import Path
from typing import Dict

from robot.parsing.model.blocks import File

from .config import Configuration
from .log import logger
from .utils import directory_to_zip


def write_test_suites(test_suites: Dict[str, File], config: Configuration) -> None:
    generation_directory = get_generation_directory(config.generationDirectory)
    if config.clearGenerationDirectory:
        clear_generation_directory(generation_directory)
    write_test_suite_files(test_suites, generation_directory)
    if config.createOutputZip:
        directory_to_zip(generation_directory)
    logger.info(f"Successfully wrote {len(test_suites)} robot files.")
    logger.info(f"Path: {Path(generation_directory).resolve()!s}")


def get_generation_directory(generation_directory: str) -> Path:
    root_path = Path(os.curdir).absolute()
    if not generation_directory:
        return root_path / "Generated"
    return Path(
        re.sub(
            r"^{root}",
            str(root_path).replace('\\', '\\\\'),
            generation_directory,
            flags=re.IGNORECASE,
        )
    )


def clear_generation_directory(generation_dir: Path) -> None:
    if generation_dir.is_dir():
        shutil.rmtree(str(generation_dir))
        logger.info("Files in generation directory deleted.")
    zip_file = "".join([str(generation_dir), ".zip"])
    Path(zip_file).unlink(missing_ok=True)


def write_test_suite_files(test_suites: Dict[str, File], generation_directory: Path) -> None:
    for test_suite_file in test_suites.values():
        test_suite_file.source = Path(generation_directory / f"{test_suite_file.source}.robot")
        logger.debug(f"File written to {os.path.relpath(test_suite_file.source)}")
        test_suite_file.save()
