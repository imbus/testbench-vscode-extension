# Copyright 2022-     imbus AG
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
import sys

import robot

from testbench2robotframework import __version__

from .config import (
    find_pyproject_toml,
    get_testbench2robotframework_toml_dict,
)
from .json_reader import read_json
from .robotframework2testbench import robot2testbench
from .testbench2robotframework import testbench2robotframework
from .utils import arg_parser


def run():
    args = arg_parser.parse_args()
    if args.subcommand is None and not args.version:
        arg_parser.print_help()
        sys.exit()
    if args.version:
        print_version()
        sys.exit()
    if not args.config:
        pyproject_toml = find_pyproject_toml()
    config_path = args.config or pyproject_toml
    if not config_path:
        configuration = {}
    elif config_path.suffix == ".json":
        configuration = read_json(args.config, False)
    else:
        configuration = get_testbench2robotframework_toml_dict(config_path)
    if args.subcommand == "write":
        testbench2robotframework(args.jsonReport[0], configuration)
    elif args.subcommand == "read":
        robot2testbench(args.jsonReport[0], args.output, args.result, configuration)


def print_version():
    print(  # noqa: T201
        f"TestBench2RobotFramework {__version__} with "
        f"[Robot Framework {robot.version.get_full_version()}]"
    )


if __name__ == "__main__":
    run()
