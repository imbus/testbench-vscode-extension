# pylint: skip-file
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib
from .model import StrEnum

DEFAULT_LIBRARY_REGEX = r"(?:.*\.)?(?P<resourceName>[^.]+?)\s*\[Robot-Library\].*"
DEFAULT_LIBRARY_ROOTS: Final[list[str]] = ["RF", "RF-Library"]
DEFAULT_RESOURCE_REGEX = r"(?:.*\.)?(?P<resourceName>[^.]+?)\s*\[Robot-Resource\].*"
DEFAULT_RESOURCE_ROOTS: Final[list[str]] = ["RF-Resource"]
DEFAULT_GENERATION_DIRECTORY = "{root}/Generated"



def find_pyproject_toml() -> Path:
    current_dir = Path().cwd()
    for parent in [current_dir, *list(current_dir.parents)]:
        pyproject_path = parent / "pyproject.toml"
        if pyproject_path.is_file():
            return pyproject_path
    return Path()


def get_testbench2robotframework_toml_dict(toml_path: Path):
    try:
        with Path(toml_path).open("rb") as toml_file:
            toml_dict = tomllib.load(toml_file)
    except FileNotFoundError:
        return {}
    return toml_dict.get("tool", {}).get("testbench2robotframework", {})


@dataclass
class SubdivisionsMapping:
    libraries: dict
    resources: dict

    @classmethod
    def from_dict(cls, dictionary):
        return cls(
            libraries=dictionary.get("libraries", {}), resources=dictionary.get("resources", {})
        )


@dataclass
class ForcedImport:
    libraries: list[str]
    resources: list[str]
    variables: list[str]

    @classmethod
    def from_dict(cls, dictionary):
        return cls(
            libraries=dictionary.get("libraries", []),
            resources=dictionary.get("resources", []),
            variables=dictionary.get("variables", []),
        )


class LogLevel(StrEnum):
    CRITICAL = "CRITICAL"
    FATAL = CRITICAL
    ERROR = "ERROR"
    WARNING = "WARNING"
    WARN = WARNING
    INFO = "INFO"
    DEBUG = "DEBUG"
    NOTSET = "NOTSET"


@dataclass
class ConsoleLoggerConfig:
    logLevel: LogLevel
    logFormat: str

    @classmethod
    def from_dict(cls, dictionary):
        log_level = dictionary.get("logLevel", "INFO").upper()
        if log_level not in LogLevel.__members__:
            print(
                f"ValueError: {log_level} is not a valid logLevel. "
                f"Available logLevel are: {list(LogLevel.__members__)}"
            )
            log_level = LogLevel.INFO
        return cls(
            logLevel=LogLevel(log_level),
            logFormat=dictionary.get("logFormat", "%(levelname)s: %(message)s"),
        )


@dataclass
class FileLoggerConfig(ConsoleLoggerConfig):
    fileName: str

    @classmethod
    def from_dict(cls, dictionary):
        log_level = dictionary.get("logLevel", "DEBUG").upper()
        if log_level not in LogLevel.__members__:
            print(
                f"ValueError: {log_level} is not a valid logLevel. "
                f"Available logLevel are: {list(LogLevel.__members__)}"
            )
            log_level = LogLevel.DEBUG
        return cls(
            logLevel=log_level,
            logFormat=dictionary.get(
                "logFormat", "%(asctime)s - %(filename)s:%(lineno)d - %(levelname)8s - %(message)s"
            ),
            fileName=dictionary.get("fileName", "testbench2robotframework.log"),
        )


@dataclass
class LoggingConfig:
    console: ConsoleLoggerConfig
    file: FileLoggerConfig

    @classmethod
    def from_dict(cls, dictionary):
        return cls(
            console=ConsoleLoggerConfig.from_dict(dictionary.get("console", {})),
            file=FileLoggerConfig.from_dict(dictionary.get("file", {})),
        )


class CompoundInteractionLogging(StrEnum):
    GROUP = "GROUP"
    COMMENT = "COMMENT"
    NONE = "NONE"


class ReferenceBehaviour(StrEnum):
    ATTACHMENT = "ATTACHMENT"
    REFERENCE = "REFERENCE"
    NONE = "NONE"


class AttachmentConflictBehaviour(StrEnum):
    ERROR = "ERROR"
    USE_NEW = "USE_NEW"
    USE_EXISTING = "USE_EXISTING"
    RENAME_NEW = "RENAME_NEW"


@dataclass
class Configuration:
    attachmentConflictBehaviour: AttachmentConflictBehaviour
    clean: bool
    compound_interaction_logging: CompoundInteractionLogging
    forced_import: ForcedImport
    fully_qualified: bool
    library_regex: list[str]
    library_root: list[str]
    log_suite_numbering: bool
    loggingConfiguration: LoggingConfig
    output_directory: str
    phasePattern: str
    referenceBehaviour: ReferenceBehaviour
    resource_directory: str
    resource_regex: list[str]
    resource_root: list[str]
    subdivisionsMapping: SubdivisionsMapping
    testCaseSplitPathRegEx: str

    @classmethod
    def from_dict(cls, dictionary) -> Configuration:
        return cls(
            clean=dictionary.get("clean", True),
            library_regex=dictionary.get(
                "library-regex", [DEFAULT_LIBRARY_REGEX]
            ),
            resource_regex=dictionary.get(
                "resource-regex", [DEFAULT_RESOURCE_REGEX]
            ),
            library_root=dictionary.get("library-root", DEFAULT_LIBRARY_ROOTS),
            resource_root=dictionary.get("resource-root", DEFAULT_RESOURCE_ROOTS),
            fully_qualified=dictionary.get("fully-qualified", False),
            forced_import=ForcedImport.from_dict(dictionary.get("forced-import", {})),
            output_directory=dictionary.get("output-directory", DEFAULT_GENERATION_DIRECTORY),
            log_suite_numbering=dictionary.get("log-suite-numbering", False),
            loggingConfiguration=LoggingConfig.from_dict(
                {
                    "console":dictionary.get("console-logging", {}),
                    "file":dictionary.get("file-logging", {})
                }
            ),
            compound_interaction_logging=CompoundInteractionLogging(dictionary.get("compound-interaction-logging", "GROUP").upper()),
            resource_directory=dictionary.get("resource-directory", "").replace(
                "\\", "/"
            ),
            testCaseSplitPathRegEx=dictionary.get("testCaseSplitPathRegEx", ".*StopWithRestart.*"),
            phasePattern=dictionary.get("phasePattern", "{testcase} : Phase {index}/{length}"),
            referenceBehaviour=ReferenceBehaviour(
                dictionary.get("referenceBehaviour", "ATTACHMENT").upper()
            ),
            subdivisionsMapping=SubdivisionsMapping.from_dict(
                {
                    "libraries":dictionary.get("library-mapping", {}),
                    "resources":dictionary.get("resource-mapping", {})
                }
            ),
            attachmentConflictBehaviour=AttachmentConflictBehaviour(
                dictionary.get("attachmentConflictBehaviour", "USE_EXISTING").upper()
            ),
        )

def write_default_config(config_file):
    with Path(config_file).open("w", encoding="utf-8") as file:
        json.dump(
            Configuration.from_dict({}).__dict__,
            file,
            default=lambda o: o.__dict__,
            indent=2,
        )
