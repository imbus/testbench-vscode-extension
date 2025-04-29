from invoke import task
import shutil

@task
def build_vsix(c):
    shutil.rmtree("bundled/libs")
    c.run("pip-compile")
    c.run("python -m nox --session bundle_dependencies")
    c.run("npm run vsix-package")


