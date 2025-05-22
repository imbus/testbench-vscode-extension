import nox

@nox.session(python="3.10")
def bundle_dependencies(session):
    session.install(
        "-t",
        "./bundled/libs",
        "--no-cache-dir",
        "--implementation",
        "py",
        "--only-binary=:all:",
        "--no-binary=:none:",
        "--upgrade",
        "-r"
        "requirements.txt",
    )