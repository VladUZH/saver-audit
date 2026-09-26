# Stub headroom package for tests (synthetic): compress() returns the messages
# unchanged, so a faithful replay saves exactly 0 tokens.
__version__ = "0.38.0"


class _Result:
    def __init__(self, messages):
        self.messages = messages


def compress(messages, model=None):
    return _Result(messages)
