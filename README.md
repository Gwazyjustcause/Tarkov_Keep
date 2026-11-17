# Tarkov Gear Compare

Compare up to three pieces of Escape from Tarkov gear side by side. The static site compares weapons, armored rigs, body armor, plates, helmets, headsets and backpacks. Weapon recoil, accuracy and ergonomics use the default in-game preset when the data is available.

The Loot checker lists tasks, Collector and Hideout uses, quantities, Found in Raid requirements and price per slot. Task and Hideout completion is stored in the current browser separately for PvP and PvE. Flea values are 24-hour averages before fees.

## Run locally

Run `python -m http.server 8000` from this directory and open `http://localhost:8000/`.

## Refresh data

Run `python refresh-data.py` to regenerate both dated snapshots using the public [Tarkov.dev API](https://tarkov.dev/api/).

## GitHub Pages

Serve the root of `main` using GitHub Pages. The site uses relative asset paths and needs no build step.
