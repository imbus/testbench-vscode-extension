import sys
import tempfile
from pathlib import Path

from .config import Configuration
from .json_reader import TestBenchJsonReader
from .log import logger, setup_logger
from .testbench2rf import create_test_suites
from .testsuite_write import write_test_suites
from .utils import PathResolver, extract_to_working_directory, is_zip_file


def testbench2robotframework(testbench_report: str, config: dict):
    configuration = Configuration.from_dict(config)
    setup_logger(configuration)
    logger.debug("Config file loaded.")
    testbench_report = Path(testbench_report)
    try:
        if is_zip_file(testbench_report):
            temp_dir = tempfile.TemporaryDirectory(dir=Path.cwd())
            working_dir = Path(temp_dir.name)
            extract_to_working_directory(testbench_report, working_dir)
        elif testbench_report.is_dir():
            working_dir = testbench_report.resolve()
        else:
            sys.exit(
                f"Provided TestBench report '{testbench_report.as_posix()}'"
                f" is neither ZIP nor directory."
            )
        reader = TestBenchJsonReader(Path(working_dir))
        path_resolver = PathResolver(
            reader.test_theme_tree,
            tuple(reader.get_test_case_set_catalog().keys()),
            configuration.logSuiteNumbering,
        )
        test_suites = create_test_suites(
            reader.get_test_case_set_catalog(), path_resolver, configuration
        )
        if not test_suites:
            logger.warning("There are no test suites in the exported TestBench Projekt.")
            return
        write_test_suites(test_suites, configuration)
    except Exception as exception:
        if temp_dir:
            temp_dir.cleanup()
        raise exception
