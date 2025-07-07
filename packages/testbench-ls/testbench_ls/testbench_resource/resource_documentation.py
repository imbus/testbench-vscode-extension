from robot.libdocpkg import LibraryDocumentation
from robot.libdocpkg.model import KeywordDoc


class ResourceDocumentation:
    def __init__(self, resource: str):
        self.resource_documenation = LibraryDocumentation(resource, doc_format="ROBOT")
        self.resource_documenation.convert_docs_to_html()
        self._keyword_documentations = None

    @property
    def keyword_documentations(self) -> list[KeywordDoc]:
        if not self._keyword_documentations:
            self._keyword_documentations = self.resource_documenation.keywords
        return self._keyword_documentations

    def get_keyword_documentation(self, keyword_uid: str) -> str:
        keyword_doc: KeywordDoc | None = next(
            filter(
                lambda keyword: f"tb:uid:{keyword_uid}" in keyword.tags, self.keyword_documentations
            ),
            None,
        )
        return keyword_doc.doc if keyword_doc else ""
