from pathlib import Path

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

TESTBENCH2ROBOTFRAMEWORK_DESCRIPTION = """testbench2robotframework converts TestBench JSON report
    to Robot Framework Code and Robot Result Model to JSON full report."""
WRITE_HELP = """Command to convert TestBench`s JSON REPORT to Robot Framework Code."""
READ_HELP = """Command to read a robot output xml file and
write the results to a TestBench JSON REPORT."""
CONFIG_OPTION_HELP = """Path to a config json file to generate robot files
    based on the given configuration.
    If no path is given testbench2robot will search for a file
    named \"config.json\" in the current working directory."""
ROBOT_OUTPUT_HELP = """Path to an XML file containing the robot results."""
ROBOT_RESULT_HELP = """Path to the directory or ZIP File the TestBench JSON reports
    with result should be saved to."""


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


@testbench2robotframework_cli.command(short_help=WRITE_HELP)
@click.option("-c", "--config", type=click.Path(path_type=Path), help=CONFIG_OPTION_HELP)
@click.option("--clearGenerationDirectory", is_flag=True, help="")
@click.option("--createOutputZip", is_flag=True, help="")
@click.option(
    "--fullyQualified",
    is_flag=True,
    help="""Option to call Robot Framework keywords by their
         fully qualified name in the generated Testsuties.""",
)
@click.option("--generationDirectory", type=click.Path(path_type=Path), help="")
@click.option(
    "--logCompoundInteractions",
    type=click.Choice(["GROUP", "COMMENT", "NONE"], case_sensitive=False),
    help="",
)
@click.option("--logSuiteNumbering", is_flag=True, help="")
@click.option("--resourceDirectory", type=click.Path(path_type=Path), help="")
@click.option(
    "--rfLibraryRegex",
    multiple=True,
    type=str,
    help="""Regex that can be used to identify TestBench
         Subdivisions that correspond to Robot Framework libraries.""",
)
@click.option(
    "--rfLibraryRoot",
    multiple=True,
    type=str,
    help="""TestBench root subdivision which's direct
         children correspond to Robot Framework libraries.""",
)
@click.option(
    "--rfResourceRegex",
    multiple=True,
    type=str,
    help="""Regex that can be used to identify TestBench Subdivisions
         that correspond to Robot Framework resources.""",
)
@click.option(
    "--rfResourceRoot",
    multiple=True,
    type=str,
    help="""TestBench root subdivision which's direct children
        correspond to Robot Framework resources.""",
)
@click.argument("jsonReport", type=click.Path(path_type=Path))
def write(  # noqa: PLR0913
    config: Path,
    cleargenerationdirectory: bool,
    createoutputzip: bool,
    fullyqualified: bool,
    generationdirectory: Path,
    logsuitenumbering: bool,
    logcompoundinteractions: str,
    resourcedirectory: Path,
    rflibraryregex: tuple[str],
    rflibraryroot: tuple[str],
    rfresourceregex: tuple[str],
    rfresourceroot: tuple[str],
    jsonreport: Path,
):
    """
    Generates Robot Framework Testsuites from a TestBench <JSONREPORT>.
    """
    configuration = get_tb2robot_file_configuration(config)

    if cleargenerationdirectory:
        configuration["clearGenerationDirectory"] = True
    else:
        configuration["clearGenerationDirectory"] = configuration.get(
            "clearGenerationDirectory", False
        )
    if createoutputzip:
        configuration["createOutputZip"] = True
    else:
        configuration["createOutputZip"] = configuration.get("createOutputZip", False)
    if fullyqualified:
        configuration["fullyQualified"] = True
    else:
        configuration["fullyQualified"] = configuration.get("fullyQualified", False)
    configuration["generationDirectory"] = (
        generationdirectory.as_posix()
        if generationdirectory
        else configuration.get("generationDirectory", DEFAULT_GENERATION_DIRECTORY)
    )
    if logsuitenumbering:
        configuration["logSuiteNumbering"] = True
    else:
        configuration["logSuiteNumbering"] = configuration.get("logSuiteNumbering", False)

    configuration["logCompoundInteractions"] = logcompoundinteractions or configuration.get(
        "logCompoundInteractions", "GROUP"
    )
    configuration["resourceDirectory"] = (
        resourcedirectory.as_posix()
        if resourcedirectory
        else configuration.get("resourceDirectory", "")
    )
    configuration["rfLibraryRegex"] = list(rflibraryregex) or configuration.get(
        "rfLibraryRegex", [DEFAULT_LIBRARY_REGEX]
    )
    configuration["rfLibraryRoots"] = list(rflibraryroot) or configuration.get(
        "rfLibraryRoots", DEFAULT_LIBRARY_ROOTS
    )
    configuration["rfResourceRegex"] = list(rfresourceregex) or configuration.get(
        "rfResourceRegex", [DEFAULT_RESOURCE_REGEX]
    )
    configuration["rfResourceRoots"] = list(rfresourceroot) or configuration.get(
        "rfResourceRoots", DEFAULT_RESOURCE_ROOTS
    )
    testbench2robotframework(jsonreport, configuration)


@testbench2robotframework_cli.command(short_help=READ_HELP)
@click.option("-c", "--config", type=click.Path(path_type=Path), help=CONFIG_OPTION_HELP)
@click.option("-r", "--result", type=click.Path(path_type=Path), help=ROBOT_RESULT_HELP)
@click.option(
    "-o", "--output", type=click.Path(path_type=Path), help=ROBOT_OUTPUT_HELP, required=True
)
@click.argument("jsonReport", type=click.Path(path_type=Path))
def read(config: Path, result: Path, output: Path, jsonreport: Path):
    """
    Read Robot Framework execution results and save to a TestBench <JSONREPORT>.
    """
    configuration = get_tb2robot_file_configuration(config)
    robot2testbench(jsonreport, output, result, configuration)


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
