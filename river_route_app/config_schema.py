from __future__ import annotations

from typing import Any

VALID_ROUTERS: frozenset[str] = frozenset({
    'Muskingum',
    'RapidMuskingum',
    'UnitMuskingum',
})
LEGACY_KEY_MAP: dict[str, str] = {
    'routing_params_file': 'params_file',
    'initial_state_file': 'channel_state_init_file',
    'final_state_file': 'channel_state_final_file',
    'input_type': 'runoff_processing_mode',
    'catchment_volumes_files': 'qlateral_files',
    'runoff_type': 'grid_accumulation_type',
    'runoff_depths_files': 'grid_runoff_files',
    'weight_table_file': 'grid_weights_file',
}
REMOVED_KEYS: frozenset[str] = frozenset({
    'connectivity_file',
    'var_catchment_volume',
})


def _is_blank(value: Any) -> bool:
    return value is None or value == '' or value == []


def clean_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only concrete, current-schema values and migrate known legacy keys."""
    if not isinstance(config, dict):
        return {}

    migrated: dict[str, Any] = {}
    for key, val in config.items():
        if not isinstance(key, str) or key.startswith('_') or key in REMOVED_KEYS:
            continue
        target_key = LEGACY_KEY_MAP.get(key, key)
        if target_key in REMOVED_KEYS:
            continue
        if target_key not in migrated or _is_blank(migrated[target_key]):
            migrated[target_key] = val

    cleaned: dict[str, Any] = {}
    for key, val in migrated.items():
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
