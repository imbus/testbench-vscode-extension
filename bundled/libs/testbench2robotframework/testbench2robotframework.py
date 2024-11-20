from typing import Dict

from .config import Configuration
from .json_reader import TestBenchJsonReader
from .log import logger, setup_logger

# from .robot_run import RobotSuiteRunner
from .testbench2rf import create_test_suites
from .testsuite_write import write_test_suites
from .utils import PathResolver, get_directory


def testbench2robotframework(json_report: str, config: Dict):
    configuration = Configuration.from_dict(config)
    setup_logger(configuration)
    logger.debug("Config file loaded.")
    json_report = get_directory(json_report)
    reader = TestBenchJsonReader(json_report)
    path_resolver = PathResolver(
        reader.test_theme_tree,
        tuple(reader.get_test_case_set_catalog().keys()),
        configuration.logSuiteNumbering,
    )
    test_suites = create_test_suites(
        reader.get_test_case_set_catalog(), path_resolver, configuration
    )
    # suite_runner = RobotSuiteRunner(test_suites, path_resolver)
    # suite_runner.run_suites()
    if not test_suites:
        logger.warning("There are no test suites in the exported TestBench Project.")
        return
    write_test_suites(test_suites, configuration)
