import click

from testbench_language_server import __version__

from .server import start_language_server


@click.command()
@click.version_option(version=__version__, prog_name="testbench-ls")
@click.argument("server-name")
@click.argument("server-port")
@click.argument("login-name")
@click.argument("session-token")
@click.argument("testbench-project")
@click.argument("testbench-tov")
def testbench_ls_cli(
    server_name,
    server_port,
    login_name,
    session_token,
    testbench_project,
    testbench_tov,
):
    """TestBench Language Server..."""
    start_language_server(
        server_name,
        server_port,
        login_name,
        session_token,
        testbench_project,
        testbench_tov,
    )
