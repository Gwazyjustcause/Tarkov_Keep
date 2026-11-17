# Tarkov Gear Compare

Compare up to three pieces of Escape from Tarkov gear side by side. The static site includes armored rigs, body armor, plates, helmets, headsets and backpacks, with separate PvP and PvE data.

## Run locally

Run `python -m http.server 8000` from this directory and open `http://localhost:8000/`.

## Refresh data

Run `python refresh-data.py` to regenerate both dated snapshots using the public [Tarkov.dev API](https://tarkov.dev/api/).

## GitHub Pages

Serve the root of `main` using GitHub Pages. The site uses relative asset paths and needs no build step.
