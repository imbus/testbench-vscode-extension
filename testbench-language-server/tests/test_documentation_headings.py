import pytest

from testbench_language_server.testbench_resource.resource_documentation import (
    ResourceDocumentation,
)
from testbench_language_server.testbench_resource.resource_utils import html_2_robot

KEYWORD_NAME = "My Keyword"


def _robot_to_html(tmp_path, documentation_lines: list[str]) -> str:
    """Convert Robot documentation to HTML the same way "Create keyword in TestBench" does."""
    continuation = "\n".join(f"    ...    {line}".rstrip() for line in documentation_lines)
    resource = tmp_path / "keywords.resource"
    resource.write_text(
        "*** Keywords ***\n"
        f"{KEYWORD_NAME}\n"
        f"    [Documentation]\n{continuation}\n"
        "    No Operation\n",
        encoding="utf-8",
    )
    html = ResourceDocumentation(str(resource)).get_keyword_documentation_by_name(KEYWORD_NAME)
    return f"<html><body>{html}</body></html>"


@pytest.mark.parametrize("heading", ["= Main =", "== Sub ==", "=== Header ==="])
def test_heading_survives_round_trip(tmp_path, heading):
    documentation = ["Intro line.", "", heading, "Some text below the header."]

    result = html_2_robot(_robot_to_html(tmp_path, documentation))

    assert result == f"Intro line.\n\n{heading}\n\nSome text below the header."


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        ("<h1>Title</h1>", "= Title ="),
        ("<h2>Title</h2>", "= Title ="),
        ("<h3>Title</h3>", "== Title =="),
        ("<h4>Title</h4>", "=== Title ==="),
        ("<h5>Title</h5>", "=== Title ==="),
    ],
)
def test_html_headings_map_to_robot_levels(html, expected):
    assert html_2_robot(f"<html><body>{html}</body></html>") == expected


def test_heading_keeps_hash_characters():
    assert html_2_robot("<html><body><h2>Issue #42</h2></body></html>") == "= Issue #42 ="
