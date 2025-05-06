import os
from invoke import task
import shutil

@task
def build_vsix(c):
    shutil.rmtree("bundled/libs")
    c.run("pip-compile")
    c.run("python -m nox --session bundle_dependencies")
    # for dir in os.listdir("bundled/libs"):
    #     if dir.startswith("robot"):
    #         shutil.rmtree(f"bundled/libs/{dir}")
    c.run("npm run vsix-package")


@task
def update_dependencies(c):
    shutil.rmtree("bundled/libs")
    c.run("pip-compile")
    c.run("python -m nox --session bundle_dependencies")
    
