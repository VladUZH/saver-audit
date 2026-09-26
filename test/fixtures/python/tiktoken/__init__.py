# Stub tiktoken for tests (synthetic). get_encoding() works when the vocabulary is in
# TIKTOKEN_CACHE_DIR. Otherwise the real one would download it: this stub only writes the
# proxies Python would use for that to $FAKE_TIKTOKEN_LOG, and fails.
import json
import os


def get_encoding(name):
    cache = os.environ.get("TIKTOKEN_CACHE_DIR")
    if cache and os.path.exists(os.path.join(cache, name)):
        return name
    log = os.environ.get("FAKE_TIKTOKEN_LOG")
    if log:
        import urllib.request

        with open(log, "a") as f:
            f.write(json.dumps(urllib.request.getproxies()) + "\n")
    raise ConnectionError("vocabulary not cached")
