import os
import re
import shutil
import tempfile
from pathlib import Path

from robot.parsing.model.blocks import File

from .config import Configuration
from .log import logger
from .utils import directory_to_zip


def write_test_suites(test_suites: dict[str, File], config: Configuration) -> None:
    generation_directory = get_generation_directory(config.output_directory)
    if config.clean:
        clear_generation_directory(generation_directory)
    if generation_directory.suffix.lower() != ".zip":
        write_test_suite_files(test_suites, generation_directory)
    else:
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as temp_dir:
            write_test_suite_files(test_suites, Path(temp_dir))
            directory_to_zip(temp_dir, generation_directory.with_suffix(""))
    logger.info(
        f"Successfully generated {len(test_suites)} Robot Framework Testsuite "
        f"in the following directory: {Path(generation_directory).resolve()!s}"
    )


def get_generation_directory(generation_directory: str) -> Path:
    root_path = Path(os.curdir).absolute()
    if not generation_directory:
        return root_path / "Generated"
    return Path(
        re.sub(
            r"^{root}",
            str(root_path).replace("\\", "\\\\"),
            generation_directory,
            flags=re.IGNORECASE,
        )
    )


def clear_generation_directory(generation_dir: Path) -> None:
    if generation_dir.is_dir():
        shutil.rmtree(str(generation_dir))
        logger.debug("Generation directory has been cleared.")
    elif generation_dir.suffix.lower() == ".zip":
        generation_dir.unlink(missing_ok=True)


def write_test_suite_files(test_suites: dict[str, File], generation_directory: Path) -> None:
    for test_suite_file in test_suites.values():
        test_suite_file.source = Path(generation_directory / f"{test_suite_file.source}.robot")
        test_suite_file.save()
        logger.debug(f"File written to {os.path.relpath(test_suite_file.source)}")
