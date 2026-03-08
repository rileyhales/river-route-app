from __future__ import annotations

from typing import Any

VALID_ROUTERS: frozenset[str] = frozenset({
    'Muskingum',
    'RapidMuskingum',
    'UnitMuskingum',
})


def clean_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only concrete, current-schema values."""
    if not isinstance(config, dict):
        return {}

    cleaned: dict[str, Any] = {}
    for key, val in config.items():
        if not isinstance(key, str) or key.startswith('_'):
            continue
        if val is None or val == '':
            continue
        if isinstance(val, list):
            compact = [x for x in val if x not in (None, '')]
            if not compact:
                continue
            cleaned[key] = compact
            continue
        cleaned[key] = val
    return cleaned


def resolve_router_name(router_name: str | None, default: str = 'Muskingum') -> str:
    router = (router_name or '').strip()
    if router in VALID_ROUTERS:
        return router
    return default if default in VALID_ROUTERS else 'Muskingum'
