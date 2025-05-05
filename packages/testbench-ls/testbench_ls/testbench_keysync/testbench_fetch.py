from pathlib import Path

from .resource_creation import create_resources_from_test_elements
from .resource_finder import get_existing_resources


def get_testbench_elements(project_name: str, tov_name: str, fetch: bool = True):
    new_resources = create_resources_from_test_elements(project_name, tov_name)
    exiting_resources = get_existing_resources()
    deleted_resources = [
        exiting_resources[uid] for uid in exiting_resources if uid not in new_resources
    ]
    moved_resources = [
        exiting_resources[uid]
        for uid in exiting_resources
        if new_resources.get(uid)
        and exiting_resources[uid].file.source != new_resources[uid].file.source
    ]
    for resource in [*deleted_resources, *moved_resources]:
        resource.file.source.unlink()
    print(f"The following TestBench Subdivisions have been deleted {deleted_resources}")
    print(f"The following TestBench Subdivisions have been moved {moved_resources}")
    exiting_resources = get_existing_resources()
    for new_resource in new_resources.values():
        if (
            fetch
            and Path(new_resource.file.source).exists()
            and new_resource != exiting_resources.get(new_resource.tb_subdivision_uid)
        ):
            continue
        new_resource.save()
