import nox

@nox.session()
def bundle_dependencies(session):
    session.install(
        "-t",
        "./bundled/libs",
        "--no-cache-dir",
        "--implementation",
        "py",
        "--no-deps",
        "--upgrade",
        "-r"
        "requirements.txt",
    )