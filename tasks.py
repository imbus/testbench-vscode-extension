import os
from invoke import task
import shutil

@task
def build_vsix(c):
    if not os.path.exists(".venv"):
        c.run("python -m venv .venv")
    if os.path.exists("bundled/libs"):
        shutil.rmtree("bundled/libs")
    c.run("pip-compile")
    c.run("./.venv/Scrips/python -m nox --session bundle_dependencies")
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
    c.run("pip-compile")
    c.run("python -m nox --session bundle_dependencies")
    
@task
def update_language_server(c):
    shutil.copytree("packages/testbench-ls/testbench_ls", "bundled/libs/testbench_ls", dirs_exist_ok=True)