from invoke import task

@task
def build_vsix(c):
    c.run("pip-compile")
    c.run("python -m nox --session bundle_dependencies")
    c.run("npm run vsix-package")


