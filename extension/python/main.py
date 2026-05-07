"""LibreOffice UNO component entry point.

Registers a protocol handler for `spreadbread:*` URLs and dispatches
menu actions to the sidebar handlers.

This module is loaded by LibreOffice; outside LO it is importable but
the registration code is guarded behind `if __name__ == ...` calls that
require the `uno` module.
"""
from __future__ import annotations

import os
import sys

# Ensure the bundled package is importable
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:  # pragma: no cover - only available inside LibreOffice
    import uno  # noqa: F401  (required side effect for com.sun.star.* imports)
    import unohelper
    from com.sun.star.frame import XDispatch, XDispatchProvider
    from com.sun.star.lang import XServiceInfo

    UNO_AVAILABLE = True
except ImportError:
    UNO_AVAILABLE = False

from spreadbreadai.client import DaemonClient  # noqa: E402  (path setup above)
from spreadbreadai.sidebar import handle_apply, handle_review  # noqa: E402

IMPL_NAME = "ai.spreadbread.ProtocolHandler"
SERVICE_NAMES = ("com.sun.star.frame.ProtocolHandler",)


if UNO_AVAILABLE:  # pragma: no cover - runs inside LibreOffice

    class SpreadbreadProtocolHandler(unohelper.Base, XDispatchProvider, XDispatch, XServiceInfo):
        def __init__(self, ctx):
            self.ctx = ctx
            self.client = DaemonClient(
                base_url=os.environ.get("SPREADBREAD_DAEMON", "http://127.0.0.1:8765"),
            )

        # XDispatchProvider
        def queryDispatch(self, url, target_frame_name, search_flags):
            if url.Protocol == "spreadbread:":
                return self
            return None

        def queryDispatches(self, requests):
            return tuple(self.queryDispatch(r.FeatureURL, r.FrameName, r.SearchFlags) for r in requests)

        # XDispatch
        def dispatch(self, url, args):
            command = url.Path
            if command == "review":
                handle_review(self.ctx, self.client)
            elif command == "apply":
                handle_apply(self.ctx, self.client)

        def addStatusListener(self, listener, url):
            pass

        def removeStatusListener(self, listener, url):
            pass

        # XServiceInfo
        def getImplementationName(self):
            return IMPL_NAME

        def supportsService(self, name):
            return name in SERVICE_NAMES

        def getSupportedServiceNames(self):
            return SERVICE_NAMES

    g_ImplementationHelper = unohelper.ImplementationHelper()
    g_ImplementationHelper.addImplementation(
        SpreadbreadProtocolHandler, IMPL_NAME, SERVICE_NAMES
    )
