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


import os
import pathlib
import sys


def update_sys_path(path_to_add: str) -> None:
    """Add given path to `sys.path`."""
    if path_to_add not in sys.path and os.path.isdir(path_to_add):
        sys.path.append(path_to_add)


BUNDLE_DIR = pathlib.Path(__file__).parent.parent
update_sys_path(os.fspath(BUNDLE_DIR))
update_sys_path(os.fspath(BUNDLE_DIR.parent.parent / "bundled" / "libs"))

from testbench_ls.cli import testbench_ls_cli

if __name__ == "__main__":
    testbench_ls_cli()
