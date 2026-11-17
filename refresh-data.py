"""Refresh the comparison snapshots with public Tarkov.dev item data."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from urllib.request import urlopen

API = "https://json.tarkov.dev"
OUTPUT = Path(__file__).resolve().parent
GROUPS = {
    "ItemPropertiesChestRig": "rig",
    "ItemPropertiesArmor": "armor",
    "ItemPropertiesHelmet": "helmet",
    "ItemPropertiesHeadphone": "headset",
    "ItemPropertiesBackpack": "backpack",
}
PROPERTIES = (
    "capacity", "class", "durability", "speedPenalty", "turnPenalty", "ergoPenalty",
    "material", "deafening", "blocksHeadset", "distanceModifier", "distortion",
    "ambientVolume", "compressorGain",
)


def fetch(endpoint):
    with urlopen(f"{API}/{endpoint}", timeout=40) as response:
        return json.load(response)["data"]


def prepare(payload, names):
    items = []
    for item in payload["items"].values():
        properties = item.get("properties") or {}
        types = item.get("types") or []
        group = GROUPS.get(properties.get("propertiesType"))
        if "armorPlate" in types:
            group = "plate"
        if not group or "preset" in types:
            continue

        armor_slots = properties.get("armorSlots") or []
        plate_slots = [slot["nameId"] for slot in armor_slots if slot.get("allowedPlates")]
        built_in = [slot for slot in armor_slots if slot.get("class")]
        coverage = [
            names.get(zone, zone)
            for zone in properties.get("zones") or []
            if not zone.startswith("Armor Zone")
        ]
        grid = [f"{pocket['width']}×{pocket['height']}" for pocket in properties.get("grids") or []]
        sell_price = max(
            (offer.get("priceRUB") or 0 for offer in item.get("sellToTrader") or []),
            default=0,
        )
        flea_allowed = "noFlea" not in types
        stats = {key: properties[key] for key in PROPERTIES if key in properties}
        stats.update({
            "weight": item.get("weight"),
            "flea": (item.get("avg24hPrice") or None) if flea_allowed else None,
            "vendor": sell_price or None,
            "footprint": f"{item['width']} × {item['height']}",
            "pockets": " · ".join(grid) or None,
            "zones": " / ".join(dict.fromkeys(coverage)) or None,
            "plateSlots": " / ".join(slot.replace("_", " ").capitalize() for slot in plate_slots)
            if armor_slots else None,
            "softClass": max((slot["class"] for slot in built_in), default=None),
        })
        items.append({
            "id": item["id"], "slug": item["normalizedName"], "group": group,
            "name": names.get(item["name"], item["normalizedName"].replace("-", " ").title()),
            "short": names.get(item.get("shortName"), ""),
            "image": item.get("image512pxLink") or item.get("baseImageLink"),
            "url": item.get("link"), "stats": stats, "fleaAllowed": flea_allowed,
        })
    return sorted(items, key=lambda item: item["name"].casefold())


def main(paths):
    if paths:
        pvp, pve, names = [json.loads(Path(path).read_text())["data"] for path in paths]
    else:
        with ThreadPoolExecutor(max_workers=3) as executor:
            pvp, pve, names = executor.map(fetch, ("regular/items", "pve/items", "regular/items_en"))
    for mode, payload in (("pvp", pvp), ("pve", pve)):
        items = prepare(payload, names)
        if len(items) < 100:
            raise ValueError(f"Incomplete {mode} item data")
        snapshot = {"date": datetime.now(timezone.utc).date().isoformat(), "items": items}
        (OUTPUT / f"{mode}.json").write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
        print(mode, len(items))


if __name__ == "__main__":
    main(sys.argv[1:])
