import os
from invoke import task
import shutil

@task
def build_vsix(c):
    if not os.path.exists(".venv"):
        c.run("python -m venv .venv")
    if os.path.exists("bundled/libs"):
        shutil.rmtree("bundled/libs")
    if  os.path.exists("requirements.txt"):
        os.remove("requirements.txt")
    c.run("pip-compile")
    c.run("python -m nox --session bundle_dependencies")
    # for dir in os.listdir("bundled/libs"):
    #     if dir.startswith("robot"):
    #         shutil.rmtree(f"bundled/libs/{dir}")
    c.run("npm run vsix-package")


@task
def update_dependencies(c):
    if not os.path.exists(".venv"):
        c.run("python -m venv .venv")
    if  os.path.exists("bundled/libs"):
        shutil.rmtree("bundled/libs")
    if  os.path.exists("requirements.txt"):
        os.remove("requirements.txt")
    c.run("pip-compile")
    c.run("python -m nox --session bundle_dependencies")
    
@task
def update_language_server(c):
    shutil.copytree("testbench-language-server/testbench_language_server", "bundled/libs/testbench_language_server", dirs_exist_ok=True)