# river-route-app

Browser app for configuring, running, and validating `river-route` simulations.

## Install

```bash
pip install river-route-app
```

## Launch

The app now ships with its own CLI:

```bash
rrlabs
```

By default the server listens on `127.0.0.1:8000`. Open <http://127.0.0.1:8000> in your browser after launch.

You can also override the bind address:

```bash
rrlabs --host 0.0.0.0 --port 8000
```

## From Source

```bash
npm install
npm run build
pip install -e .
rrlabs
```
