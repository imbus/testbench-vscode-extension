import click
from testbench_keysync import __version__

from .testbench_fetch import get_testbench_elements


@click.group(help="")
@click.version_option(
    __version__,
    "-v",
    "--version",
    help="",
)
@click.help_option("-h", "--help")
def testbench_keysync_cli():
    pass


@testbench_keysync_cli.command(short_help="")
def pull():
    get_testbench_elements("RF Resources", "tov", False)


@testbench_keysync_cli.command(short_help="")
def fetch():
    get_testbench_elements("RF Resources", "tov")
