from pathlib import Path

from .resource_file import RobotResourceFile


def get_existing_resource_paths() -> list[Path]:
    return list(Path.cwd().rglob("*.resource"))


def get_existing_resources() -> dict[str, RobotResourceFile]:
    resource_paths = get_existing_resource_paths()
    resources = {}
    for path in resource_paths:
        resource = RobotResourceFile.from_file(path)
        resources[resource.tb_subdivision_uid] = resource
    return resources
