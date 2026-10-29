"""Single source of truth for the loopback port used by the in-process API fixtures.

Both ``conftest.py`` and ``test_request_limits.py`` need this constant. The test module used to
do ``from conftest import API_PORT``, but ``python-tools/tests/`` also contains a ``conftest.py``
and neither directory is a Python package (no ``__init__.py``). Under pytest's default ``prepend``
import mode both directories are placed on ``sys.path`` and both conftest files are importable
under the *same* top-level name ``conftest``; whichever directory landed first won. In practice
``python-tools/tests/conftest.py`` shadowed ``python/tests/conftest.py``, so collection of the
whole suite died with::

    ImportError: cannot import name 'API_PORT' from 'conftest'
        (/…/python-tools/tests/conftest.py)

A uniquely named module removes the ambiguity without turning either test directory into a
package or changing pytest's import mode for the whole project.
"""

from __future__ import annotations

API_PORT = 8798
