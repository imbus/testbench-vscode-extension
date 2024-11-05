import os
import pathlib
import site
import sys

if __name__ == "__main__":
    path_to_add = os.fspath(pathlib.Path(__file__).parent.parent.parent / "libs")

    print('This is the res path:')
    print(path_to_add)

    if path_to_add not in sys.path and pathlib.Path(path_to_add).is_dir():
        sys.path.insert(0, path_to_add)
        print('added path')
    else:
        print('no path added')

    from testbench2robotframework.__main__ import run

    run()
