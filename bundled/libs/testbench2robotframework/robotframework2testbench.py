import sys
from pathlib import Path
from typing import Optional

from robot.api import ExecutionResult

from .config import Configuration
from .log import logger, setup_logger
from .result_writer import ResultWriter


def robot2testbench(
    json_input_report: str,
    robot_result_xml: str,
    json_output_result: Optional[str] = None,
    config: Optional[dict] = None,
):
    if not Path(json_input_report).exists():
        sys.exit("Could not find json directory or zip file at the given path.")
    if not Path(robot_result_xml).exists():
        sys.exit("Robot result xml does not exist at the given path.")
    configuration = Configuration.from_dict(config)
    setup_logger(configuration)
    logger.debug("Configuration loaded.")
    result = ExecutionResult(robot_result_xml)
    logger.debug("Robot framework result xml loaded.")
    result.visit(
        ResultWriter(json_input_report, json_output_result, configuration, robot_result_xml)
    )
