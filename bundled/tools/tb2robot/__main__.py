import os
import pathlib
import site
import sys

if __name__ == "__main__":
    path_to_add = os.fspath(pathlib.Path(__file__).parent.parent.parent / "libs")
    if path_to_add not in sys.path and pathlib.Path(path_to_add).is_dir():
        sys.path.insert(0, path_to_add)       
    else:
        pass

    # This is the entry point for the testbench2robotframework library.
    # If the name of the entry point (testbench2robotframework_cli) changes in the library, this file needs to be updated.
    from testbench2robotframework.__main__ import testbench2robotframework_cli

    testbench2robotframework_cli()
