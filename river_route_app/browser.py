import os


def browse_directory(path: str, mode: str = 'file') -> dict:
    path = os.path.abspath(path or os.getcwd())

    if not os.path.isdir(path):
        return {
            'type': 'browse_result',
            'path': path,
            'entries': [],
            'error': f'Not a directory: {path}',
        }

    entries = []
    try:
        for name in sorted(os.listdir(path)):
            if name.startswith('.'):
                continue
            full = os.path.join(path, name)
            try:
                stat = os.stat(full)
                entry_type = 'directory' if os.path.isdir(full) else 'file'
                # In directory mode, only show directories
                if mode == 'directory' and entry_type != 'directory':
                    continue
                entries.append({
                    'name': name,
                    'type': entry_type,
                    'size': stat.st_size if entry_type == 'file' else None,
                })
            except OSError:
                continue
    except PermissionError:
        return {
            'type': 'browse_result',
            'path': path,
            'entries': [],
            'error': f'Permission denied: {path}',
        }

    return {
        'type': 'browse_result',
        'path': path,
        'entries': entries,
    }
