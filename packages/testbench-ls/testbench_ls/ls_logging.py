from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING

from testbench_ls.messages import TESTBENCH_LS_CLASS_NAME

if TYPE_CHECKING:
    from pygls.server import LanguageServer


class LogLevel(Enum):
    ERROR = "error"
    WARN = "warn"
    INFO = "info"
    DEBUG = "debug"
    TRACE = "trace"


def show_error(ls: LanguageServer, message: str):
    ls.send_notification(
        f"{TESTBENCH_LS_CLASS_NAME}/show-error",
        {"message": message},
    )


def show_info(ls: LanguageServer, message: str):
    ls.send_notification(
        f"{TESTBENCH_LS_CLASS_NAME}/show-info",
        {"message": message},
    )


def log(ls: LanguageServer, message: str, level: LogLevel = LogLevel.INFO):
    ls.send_notification(
        f"{TESTBENCH_LS_CLASS_NAME}/log-{level.value}",
        {"message": message},
    )
