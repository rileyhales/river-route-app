import os

import numpy as np
import xarray as xr


def read_result_data(files: list[str], river_id: int,
                     var_river_id: str | None = None,
                     var_discharge: str | None = None) -> dict:
    if not files:
        return {'type': 'result_data', 'error': 'No output files provided'}

    missing = [f for f in files if not os.path.isfile(f)]
    if missing:
        return {'type': 'result_data', 'error': f'Files not found: {", ".join(missing)}'}

    try:
        ds = xr.open_mfdataset(files, combine='nested', concat_dim='time')

        # Find the river_id dimension variable — use provided name first, then search
        id_var_name = None
        if var_river_id and var_river_id in ds:
            id_var_name = var_river_id
        else:
            for name in ('river_id', 'rivid', 'station_id', 'feature_id'):
                if name in ds:
                    id_var_name = name
                    break
            if id_var_name is None:
                for name in ds.dims:
                    if name != 'time' and name in ds:
                        id_var_name = name
                        break
        if id_var_name is None:
            ds.close()
            return {'type': 'result_data', 'error': 'Could not find river ID variable in files'}

        river_ids = ds[id_var_name].values
        idx = np.where(river_ids == river_id)[0]
        if len(idx) == 0:
            ds.close()
            return {'type': 'result_data', 'error': f'River ID {river_id} not found in files'}
        idx = int(idx[0])

        # Read time
        times = ds['time'].values
        time_strings = [str(np.datetime_as_string(t, unit='s')) for t in times]

        # Find discharge variable — use provided name first, then search
        q_var_name = None
        if var_discharge and var_discharge in ds:
            q_var_name = var_discharge
        else:
            for name in ('Q', 'discharge', 'Qout', 'streamflow'):
                if name in ds:
                    q_var_name = name
                    break
            if q_var_name is None:
                for name, var in ds.data_vars.items():
                    if len(var.dims) == 2 and name != id_var_name:
                        q_var_name = name
                        break
        if q_var_name is None:
            ds.close()
            return {'type': 'result_data', 'error': 'Could not find discharge variable in files'}

        discharge = ds[q_var_name].isel({id_var_name: idx}).values.astype(float).tolist()
        ds.close()

        stats = {
            'min': float(np.nanmin(discharge)),
            'max': float(np.nanmax(discharge)),
            'mean': float(np.nanmean(discharge)),
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


def list_result_files(directory: str) -> dict:
    directory = os.path.abspath(directory or os.getcwd())

    if not os.path.isdir(directory):
        return {'type': 'result_files', 'files': [], 'error': f'Not a directory: {directory}'}

    files = []
    try:
        for name in sorted(os.listdir(directory)):
            if not name.endswith('.nc'):
                continue
            full = os.path.join(directory, name)
            if not os.path.isfile(full):
                continue
            stat = os.stat(full)
            files.append({
                'name': name,
                'path': full,
                'size': stat.st_size,
                'modified': os.path.getmtime(full),
            })
    except PermissionError:
        return {'type': 'result_files', 'files': [], 'error': f'Permission denied: {directory}'}

    return {
        'type': 'result_files',
        'files': files,
    }
