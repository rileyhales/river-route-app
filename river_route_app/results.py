import csv
import io
import math
import os

import numpy as np
import xarray as xr


def _open_multi(files: list[str]):
    """Open multi-file discharge datasets with conservative merge settings for speed and compatibility."""
    return xr.open_mfdataset(
        files,
        combine='nested',
        concat_dim='time',
        data_vars='minimal',
        coords='minimal',
        compat='override',
        parallel=False,
    )


def _find_id_var(ds, var_river_id: str | None = None):
    """Find the river/station ID coordinate variable in a dataset."""
    if var_river_id and var_river_id in ds:
        return var_river_id
    for name in ('river_id', 'rivid', 'station_id', 'feature_id'):
        if name in ds:
            return name
    for name in ds.dims:
        if name != 'time' and name in ds:
            return name
    return None


def _find_q_var(ds, var_discharge: str | None = None, id_var_name: str | None = None):
    """Find the discharge/streamflow data variable in a dataset."""
    if var_discharge and var_discharge in ds:
        return var_discharge
    for name in ('Q', 'discharge', 'Qout', 'streamflow'):
        if name in ds:
            return name
    for name, var in ds.data_vars.items():
        if len(var.dims) == 2 and name != id_var_name:
            return name
    return None


def _json_number(value, digits: int | None = None):
    """Convert a numeric value to a JSON-safe float (None for NaN/Inf)."""
    try:
        out = float(value)
    except Exception:
        return None
    if not math.isfinite(out):
        return None
    if digits is not None:
        out = round(out, digits)
    return out


def list_river_ids(files: list[str],
                   var_river_id: str | None = None) -> dict:
    """Return sorted list of river IDs from output files."""
    if not files:
        return {'type': 'river_id_list', 'error': 'No files provided'}

    missing = [f for f in files if not os.path.isfile(f)]
    if missing:
        return {'type': 'river_id_list', 'error': f'Files not found: {", ".join(missing)}'}

    try:
        # ID dimension is identical across discharge files; opening one file avoids expensive multi-file concat.
        with xr.open_dataset(files[0]) as ds:
            id_var = _find_id_var(ds, var_river_id)
            if id_var is None:
                return {'type': 'river_id_list', 'error': 'Could not find river ID variable'}
            ids = sorted(int(x) for x in ds[id_var].values)
            return {'type': 'river_id_list', 'ids': ids, 'count': len(ids)}
    except Exception as e:
        return {'type': 'river_id_list', 'error': str(e)}


def validate_results(sim_files: list[str], ref_files: list[str],
                     river_ids: list[int] | None = None,
                     var_river_id: str | None = None,
                     var_discharge: str | None = None,
                     ref_csv: str | None = None,
                     csv_river_id: int | None = None,
                     csv_river_ids: list[int] | None = None) -> dict:
    """Compare simulation results against reference/observed data.

    Supports reference as netCDF files or a CSV string.
    CSV format: river_id, datetime, discharge (one header row).
    Computes KGE, NSE, RMSE, percent bias per river.
    """
    try:
        # Open simulation dataset
        if not sim_files:
            return {'type': 'validation_result_data', 'error': 'No simulation files provided'}
        missing = [f for f in sim_files if not os.path.isfile(f)]
        if missing:
            return {'type': 'validation_result_data', 'error': f'Sim files not found: {", ".join(missing)}'}

        with _open_multi(sim_files) as sim_ds:
            sim_id_var = _find_id_var(sim_ds, var_river_id)
            sim_q_var = _find_q_var(sim_ds, var_discharge, sim_id_var)
            if sim_id_var is None or sim_q_var is None:
                return {'type': 'validation_result_data',
                        'error': 'Could not find river ID or discharge variable in simulation files'}

            sim_ids = sim_ds[sim_id_var].values
            sim_times = sim_ds['time'].values
            sim_time_index = {np.datetime64(t): i for i, t in enumerate(sim_times)}

            # Load reference data
            if ref_csv:
                default_csv_ids: list[int] | None = None
                if csv_river_ids:
                    default_csv_ids = [int(x) for x in csv_river_ids if int(x) > 0]
                elif csv_river_id is not None:
                    default_csv_ids = [int(csv_river_id)]
                elif river_ids:
                    default_csv_ids = [int(x) for x in river_ids if int(x) > 0]
                ref_data = _parse_ref_csv(ref_csv, default_river_ids=default_csv_ids)
            elif ref_files:
                ref_missing = [f for f in ref_files if not os.path.isfile(f)]
                if ref_missing:
                    return {'type': 'validation_result_data',
                            'error': f'Reference files not found: {", ".join(ref_missing)}'}
                ref_data = _load_ref_nc(ref_files, var_river_id, var_discharge)
            else:
                return {'type': 'validation_result_data', 'error': 'No reference data provided'}

            if 'error' in ref_data:
                return {'type': 'validation_result_data', 'error': ref_data['error']}

            # Determine which rivers to validate
            sim_id_set = set(int(x) for x in sim_ids)
            ref_id_set = set(ref_data['ids'])
            if river_ids:
                target_ids = river_ids
            else:
                target_ids = sorted(sim_id_set & ref_id_set)

            if not target_ids:
                # Build a diagnostic message
                sim_sample = sorted(sim_id_set)[:5]
                ref_sample = sorted(ref_id_set)[:5]
                return {'type': 'validation_result_data',
                        'error': f'No common river IDs between simulation '
                                 f'(e.g. {sim_sample}) and reference (e.g. {ref_sample})'}

            # Cast sim_ids to int for reliable comparison
            sim_ids_int = sim_ids.astype(int)
            results = []
            for rid in target_ids:
                sim_idx = np.where(sim_ids_int == rid)[0]
                if len(sim_idx) == 0:
                    continue
                sim_idx = int(sim_idx[0])
                sim_q = sim_ds[sim_q_var].isel({sim_id_var: sim_idx}).values.astype(float)

                ref_entry = ref_data['data'].get(int(rid))
                if ref_entry is None:
                    continue

                ref_t = ref_entry['times']
                ref_q = ref_entry['discharge']

                # Align on common timestamps
                common_indices_sim = []
                common_indices_ref = []
                for ri, rt in enumerate(ref_t):
                    rt64 = np.datetime64(rt)
                    sim_idx = sim_time_index.get(rt64)
                    if sim_idx is not None:
                        common_indices_sim.append(sim_idx)
                        common_indices_ref.append(ri)

                if len(common_indices_sim) < 2:
                    results.append({
                        'river_id': int(rid),
                        'error': f'Only {len(common_indices_sim)} common timesteps',
                        'n_common': len(common_indices_sim),
                    })
                    continue

                s = sim_q[common_indices_sim]
                o = np.array(ref_q)[common_indices_ref]

                # Filter NaN
                mask = ~(np.isnan(s) | np.isnan(o))
                s = s[mask]
                o = o[mask]
                if len(s) < 2:
                    results.append({
                        'river_id': int(rid),
                        'error': 'Insufficient non-NaN data',
                        'n_common': int(mask.sum()),
                    })
                    continue

                metrics = _compute_metrics(s, o)
                metrics['river_id'] = int(rid)
                metrics['n_common'] = len(s)
                results.append(metrics)

        return {
            'type': 'validation_result_data',
            'results': results,
            'n_rivers': len(results),
            'n_common_rivers': len(target_ids),
        }

    except Exception as e:
        return {'type': 'validation_result_data', 'error': str(e)}


def _compute_metrics(sim: np.ndarray, obs: np.ndarray) -> dict:
    """Compute KGE, NSE, RMSE, percent bias."""
    mean_obs = np.mean(obs)
    mean_sim = np.mean(sim)

    # NSE
    ss_res = np.sum((obs - sim) ** 2)
    ss_tot = np.sum((obs - mean_obs) ** 2)
    nse = 1 - ss_res / ss_tot if ss_tot > 0 else float('nan')

    # RMSE
    rmse = float(np.sqrt(np.mean((sim - obs) ** 2)))
    mae = float(np.mean(np.abs(sim - obs)))

    # Percent bias
    pbias = 100 * float(np.sum(sim - obs) / np.sum(obs)) if np.sum(obs) != 0 else float('nan')

    # KGE 2012 — uses CV ratio (gamma) instead of variance ratio (alpha)
    r = float(np.corrcoef(sim, obs)[0, 1]) if len(sim) > 1 else float('nan')
    beta = mean_sim / mean_obs if mean_obs != 0 else float('nan')
    cv_sim = float(np.std(sim) / mean_sim) if mean_sim != 0 else float('nan')
    cv_obs = float(np.std(obs) / mean_obs) if mean_obs != 0 else float('nan')
    gamma = cv_sim / cv_obs if cv_obs != 0 else float('nan')
    kge = 1 - float(np.sqrt((r - 1) ** 2 + (gamma - 1) ** 2 + (beta - 1) ** 2))

    return {
        'kge': _json_number(kge, 4),
        'kge_2012': _json_number(kge, 4),
        'nse': _json_number(nse, 4),
        'rmse': _json_number(rmse, 4),
        'mae': _json_number(mae, 4),
        'pbias': _json_number(pbias, 2),
        'r': _json_number(r, 4),
        'mean_sim': _json_number(mean_sim, 4),
        'mean_obs': _json_number(mean_obs, 4),
    }


def _parse_ref_csv(csv_text: str,
                   default_river_id: int | None = None,
                   default_river_ids: list[int] | None = None) -> dict:
    """Parse reference CSV. Supports two formats:

    3-column: river_id, datetime, discharge (multiple rivers)
    2-column: datetime, discharge (applied to selected river IDs)
    """
    try:
        reader = csv.reader(io.StringIO(csv_text))
        header = next(reader, None)
        if not header or len(header) < 2:
            return {'error': 'CSV must have at least 2 columns (datetime, discharge) '
                    'or 3 columns (river_id, datetime, discharge)'}

        ncols = len(header)
        # Detect format: if first data value in col 0 looks like an integer, it's 3-col
        rows = list(reader)
        if len(rows) == 0:
            return {'error': 'CSV has no data rows'}

        is_three_col = ncols >= 3
        if is_three_col:
            # Check if first column is actually a river ID (integer) or a datetime
            try:
                int(float(rows[0][0].strip()))
            except (ValueError, TypeError):
                is_three_col = False

        data = {}
        skipped = 0
        for row in rows:
            if is_three_col:
                if len(row) < 3:
                    skipped += 1
                    continue
                try:
                    rid = int(float(row[0]))
                    dt = np.datetime64(row[1].strip())
                    q = float(row[2])
                except (ValueError, TypeError):
                    skipped += 1
                    continue
            else:
                if len(row) < 2:
                    skipped += 1
                    continue
                ids = []
                if default_river_ids:
                    ids = sorted({int(x) for x in default_river_ids if int(x) > 0})
                elif default_river_id is not None:
                    ids = [int(default_river_id)]
                if not ids:
                    return {'error': 'CSV has 2 columns (datetime, discharge) but no river IDs were provided. '
                            'Select one or more River IDs from NetCDF, or use a 3-column CSV '
                            '(river_id, datetime, discharge).'}
                try:
                    dt = np.datetime64(row[0].strip())
                    q = float(row[1])
                except (ValueError, TypeError):
                    skipped += 1
                    continue
                for rid in ids:
                    if rid not in data:
                        data[rid] = {'times': [], 'discharge': []}
                    data[rid]['times'].append(dt)
                    data[rid]['discharge'].append(q)
                continue

            if rid not in data:
                data[rid] = {'times': [], 'discharge': []}
            data[rid]['times'].append(dt)
            data[rid]['discharge'].append(q)

        if not data:
            return {'error': f'Could not parse any rows from CSV ({skipped} rows skipped). '
                    'Expected format: datetime,discharge or river_id,datetime,discharge'}

        return {'ids': sorted(data.keys()), 'data': data}
    except Exception as e:
        return {'error': f'CSV parse error: {e}'}


def _load_ref_nc(files: list[str],
                 var_river_id: str | None = None,
                 var_discharge: str | None = None) -> dict:
    """Load reference netCDF files into the same format as CSV parse."""
    try:
        with _open_multi(files) as ds:
            id_var = _find_id_var(ds, var_river_id)
            q_var = _find_q_var(ds, var_discharge, id_var)
            if id_var is None or q_var is None:
                return {'error': 'Could not find river ID or discharge variable in reference files'}

            ids = ds[id_var].values
            times = ds['time'].values
            data = {}
            for i, rid in enumerate(ids):
                rid_int = int(rid)
                q = ds[q_var].isel({id_var: i}).values.astype(float).tolist()
                data[rid_int] = {'times': times, 'discharge': q}

            return {'ids': sorted(data.keys()), 'data': data}
    except Exception as e:
        return {'error': f'Reference netCDF error: {e}'}


def read_ref_csv_data(ref_csv: str,
                      river_id: int,
                      csv_river_id: int | None = None,
                      csv_river_ids: list[int] | None = None) -> dict:
    """Read a single-river reference hydrograph from CSV text for charting."""
    if not ref_csv or not str(ref_csv).strip():
        return {'type': 'result_data', 'error': 'No CSV reference data provided'}

    ref_data = _parse_ref_csv(
        ref_csv,
        default_river_id=csv_river_id,
        default_river_ids=csv_river_ids,
    )
    if 'error' in ref_data:
        return {'type': 'result_data', 'error': ref_data['error']}

    rid = int(river_id)
    entry = ref_data['data'].get(rid)
    if entry is None:
        available = sorted(ref_data['data'].keys())[:5]
        return {
            'type': 'result_data',
            'error': f'River ID {rid} not found in CSV reference data (e.g. {available})',
        }

    times = np.array(entry['times']).astype('datetime64[s]')
    discharge_array = np.array(entry['discharge'], dtype=float)
    if discharge_array.size == 0:
        return {'type': 'result_data', 'error': f'No discharge values for river ID {rid} in CSV reference data'}

    time_strings = times.astype(str).tolist()
    discharge = discharge_array.tolist()
    stats = {
        'min': _json_number(np.nanmin(discharge_array)),
        'max': _json_number(np.nanmax(discharge_array)),
        'mean': _json_number(np.nanmean(discharge_array)),
    }
    return {
        'type': 'result_data',
        'river_id': rid,
        'times': time_strings,
        'discharge': discharge,
        'stats': stats,
    }


def read_result_data(files: list[str], river_id: int,
                     var_river_id: str | None = None,
                     var_discharge: str | None = None) -> dict:
    if not files:
        return {'type': 'result_data', 'error': 'No output files provided'}

    missing = [f for f in files if not os.path.isfile(f)]
    if missing:
        return {'type': 'result_data', 'error': f'Files not found: {", ".join(missing)}'}

    try:
        with _open_multi(files) as ds:
            id_var_name = _find_id_var(ds, var_river_id)
            if id_var_name is None:
                return {'type': 'result_data', 'error': 'Could not find river ID variable in files'}

            river_ids = ds[id_var_name].values
            river_ids_int = river_ids.astype(int)
            idx = np.where(river_ids_int == int(river_id))[0]
            if len(idx) == 0:
                return {'type': 'result_data', 'error': f'River ID {river_id} not found in files'}
            idx = int(idx[0])

            times = ds['time'].values.astype('datetime64[s]')
            time_strings = times.astype(str).tolist()

            q_var_name = _find_q_var(ds, var_discharge, id_var_name)
            if q_var_name is None:
                return {'type': 'result_data', 'error': 'Could not find discharge variable in files'}

            discharge_array = ds[q_var_name].isel({id_var_name: idx}).values.astype(float)
            discharge = discharge_array.tolist()

        stats = {
            'min': _json_number(np.nanmin(discharge_array)),
            'max': _json_number(np.nanmax(discharge_array)),
            'mean': _json_number(np.nanmean(discharge_array)),
        }

        return {
            'type': 'result_data',
            'river_id': river_id,
            'times': time_strings,
            'discharge': discharge,
            'stats': stats,
        }

    except Exception as e:
        return {'type': 'result_data', 'error': str(e)}
