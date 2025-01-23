from pathlib import Path
from typing import Any

import click
import robot

from testbench2robotframework import __version__
from testbench2robotframework.robotframework2testbench import robot2testbench

from .config import (
    DEFAULT_GENERATION_DIRECTORY,
    DEFAULT_LIBRARY_REGEX,
    DEFAULT_LIBRARY_ROOTS,
    DEFAULT_RESOURCE_REGEX,
    DEFAULT_RESOURCE_ROOTS,
    find_pyproject_toml,
    get_testbench2robotframework_toml_dict,
)
from .json_reader import read_json
from .testbench2robotframework import testbench2robotframework

TESTBENCH2ROBOTFRAMEWORK_DESCRIPTION = """TestBench2RobotFramework converts a TestBench JSON-report
    to Robot Framework test suites and enhances the TestBench Report
     with the execution results provided by Robot Framework."""
GENERATE_HELP = """Command to convert a TestBench JSON-report to Robot Framework test suites."""
FETCH_HELP = """Command to fetch execution results from a Robot Framework result XML and
to write the results to a TestBench JSON-report."""
CONFIG_OPTION_HELP = """Path to a configuration file for TestBench2RobotFramework.
    """
ROBOT_RESULT_HELP = """Path to an XML file containing the robot results."""
ROBOT_OUTPUT_HELP = """Path to the directory or ZIP File the TestBench JSON-report
    with result should be saved to."""


def parse_subdivision_mapping(
    ctx: click.Context, param: click.Option, values: tuple[str, ...]
) -> dict[str, Any]:
    subdivision_mapping = {}
    for value in values:
        try:
            subdivision, import_value = value.split(":", 1)
            subdivision_mapping[subdivision] = import_value
        except ValueError as err:
            raise click.BadParameter("Each mapping must be in 'name:value' format.") from err
    return subdivision_mapping


@click.group(help=TESTBENCH2ROBOTFRAMEWORK_DESCRIPTION)
@click.version_option(
    __version__,
    "-v",
    "--version",
    help="Writes the TestBench2RobotFramework, Robot Framework and Python version to console.",
    message=(
        f"TestBench2RobotFramework {__version__} with "
        f"Robot Framework {robot.version.get_full_version()}"
    ),
)
@click.help_option("-h", "--help")
def testbench2robotframework_cli():
    pass


@testbench2robotframework_cli.command(short_help=GENERATE_HELP)
@click.option("-c", "--config", type=click.Path(path_type=Path), help=CONFIG_OPTION_HELP)
@click.option(
    "--clean",
    is_flag=True,
    help="""Deletes all files present in the output-directory
    before new test suites are created.""",
)
@click.option(
    "--fully-qualified",
    is_flag=True,
    help="""Option to call Robot Framework keywords by their
         fully qualified name in the generated test suites.""",
)
@click.option(
    "-d",
    "--output-directory",
    type=click.Path(path_type=Path),
    help="Directory or ZIP archive containing the generated test suites.",
)
@click.option(
    "--compound-interaction-logging",
    type=click.Choice(["GROUP", "COMMENT", "NONE"], case_sensitive=False),
    help="Mode for logging compound interactions.",
)
@click.option(
    "--log-suite-numbering", is_flag=True, help="Enables logging of the test suite numbering."
)
@click.option(
    "--resource-directory",
    type=click.Path(path_type=Path),
    help="Directory containing the Robot Framework resource files.",
)
@click.option(
    "--library-regex",
    multiple=True,
    type=str,
    help="""Regex that can be used to identify TestBench
         Subdivisions that correspond to Robot Framework libraries.""",
)
@click.option(
    "--library-root",
    multiple=True,
    type=str,
    help="""TestBench root subdivision which's direct
         children correspond to Robot Framework libraries.""",
)
@click.option(
    "--resource-regex",
    multiple=True,
    type=str,
    help="""Regex that can be used to identify TestBench Subdivisions
         that correspond to Robot Framework resources.""",
)
@click.option(
    "--resource-root",
    multiple=True,
    type=str,
    help="""TestBench root subdivision which's direct children
        correspond to Robot Framework resources.""",
)
@click.option(
    "--library-mapping",
    multiple=True,
    callback=parse_subdivision_mapping,
    help="",
)
@click.option(
    "--resource-mapping",
    multiple=True,
    callback=parse_subdivision_mapping,
    help="",
)
@click.argument("testbench-report", type=click.Path(path_type=Path))
def generate_tests(  # noqa: PLR0913
    clean: bool,
    compound_interaction_logging: str,
    config: Path,
    fully_qualified: bool,
    library_regex: tuple[str],
    library_root: tuple[str],
    log_suite_numbering: bool,
    output_directory: Path,
    resource_directory: Path,
    resource_regex: tuple[str],
    resource_root: tuple[str],
    testbench_report: Path,
    library_mapping: dict[str, str],
    resource_mapping: dict[str, str],
):
    """
    Generates Robot Framework Testsuites from a <TestBench Report>.
    """
    configuration = get_tb2robot_file_configuration(config)
    if clean:
        configuration["clean"] = True
    else:
        configuration["clean"] = configuration.get("clean", False)
    if fully_qualified:
        configuration["fully-qualified"] = True
    else:
        configuration["fully-qualified"] = configuration.get("fully-qualified", False)
    configuration["output-directory"] = (
        output_directory.as_posix()
        if output_directory
        else configuration.get("output-directory", DEFAULT_GENERATION_DIRECTORY)
    )
    configuration["library-mapping"] = library_mapping or configuration.get("library-mapping", {})
    if log_suite_numbering:
        configuration["log-suite-numbering"] = True
    else:
        configuration["log-suite-numbering"] = configuration.get("log-suite-numbering", False)

    configuration["compound-interaction-logging"] = (
        compound_interaction_logging or configuration.get("compound-interaction-logging", "GROUP")
    )
    configuration["resource-directory"] = (
        resource_directory.as_posix()
        if resource_directory
        else configuration.get("resource-directory", "")
    )
    configuration["resource-mapping"] = resource_mapping or configuration.get(
        "resource-mapping", {}
    )
    configuration["library-regex"] = list(library_regex) or configuration.get(
        "library-regex", [DEFAULT_LIBRARY_REGEX]
    )
    configuration["library-root"] = list(library_root) or configuration.get(
        "library-root", DEFAULT_LIBRARY_ROOTS
    )
    configuration["resource-regex"] = list(resource_regex) or configuration.get(
        "resource-regex", [DEFAULT_RESOURCE_REGEX]
    )
    configuration["resource-root"] = list(resource_root) or configuration.get(
        "resource-root", DEFAULT_RESOURCE_ROOTS
    )
    testbench2robotframework(testbench_report, configuration)


@testbench2robotframework_cli.command(short_help=FETCH_HELP)
@click.option("-c", "--config", type=click.Path(path_type=Path), help=CONFIG_OPTION_HELP)
@click.option("-d", "--output-directory", type=click.Path(path_type=Path), help=ROBOT_OUTPUT_HELP)
@click.argument("robot-result", type=click.Path(path_type=Path))
@click.argument("testbench-report", type=click.Path(path_type=Path))
def fetch_results(config: Path, robot_result: Path, output_directory: Path, testbench_report: Path):
    """
    Fetch Robot Framework execution results from <output XML> and save to a <TestBench Report>.
    """
    configuration = get_tb2robot_file_configuration(config)
    robot2testbench(testbench_report, robot_result, output_directory, configuration)


def get_tb2robot_file_configuration(config: Path) -> dict:
    if not config:
        pyproject_toml = find_pyproject_toml()
    config_path = config or pyproject_toml
    if not config_path:
        configuration = {}
    elif config_path.suffix == ".json":
        configuration = read_json(config, False)
    else:
        configuration = get_testbench2robotframework_toml_dict(config_path)
    return configuration
