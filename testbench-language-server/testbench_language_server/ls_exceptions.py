class TestBenchKeywordNotFound(Exception):
    def __init__(self, uid):
        self.uid = uid
        super().__init__(f"TestBench keyword with uid '{uid}' not found.")


class TestBenchSubdivisionNotFound(Exception):
    def __init__(self, uid):
        self.uid = uid
        super().__init__(f"TestBench subdivision with uid '{uid}' not found.")


class MultipleKeywordsWithUid(Exception):
    def __init__(self, uid):
        super().__init__(f"Multiple matching keywords found with uid '{uid}' found.")


class MultipleKeywordsWithName(Exception):
    def __init__(self, name):
        super().__init__(f"Multiple matching keywords found with name '{name}' found.")
