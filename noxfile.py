import nox

@nox.session(python="3.9")
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