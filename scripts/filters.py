"""Build offline by default. --update explicitly refreshes the credited source."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://raw.githubusercontent.com/AdAway/adaway.github.io/master/hosts.txt"
HOSTS = ROOT / "vendor/adaway/hosts.txt"
LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
DOMAIN = re.compile(rf"{LABEL}(?:\.{LABEL})+\Z")


def parse_hosts(source):
    domains = set()
    for line in source.splitlines():
        fields = line.split("#", 1)[0].split()
        if len(fields) < 2 or fields[0] not in ("127.0.0.1", "0.0.0.0", "::1"):
            continue
        for name in fields[1:]:
            name = name.lower().rstrip(".")
            if DOMAIN.fullmatch(name) and not all(c.isdigit() or c == "." for c in name):
                domains.add(name)
    return domains


def build(source):
    community = parse_hosts(source)
    if len(community) < 1000:
        raise ValueError("La liste téléchargée semble incomplète ; aucune mise à jour appliquée.")
    base = set(json.loads((ROOT / "rules/base-domains.json").read_text()))
    if not all(DOMAIN.fullmatch(d) for d in base):
        raise ValueError("Domaine local invalide")
    merged = sorted(base | community)
    rule = {"id": 1, "priority": 1, "action": {"type": "block"}, "condition": {
        "requestDomains": merged,
        "resourceTypes": ["sub_frame", "stylesheet", "script", "image", "font", "object",
                          "xmlhttprequest", "ping", "media", "websocket", "other"]}}
    metadata = {"source": SOURCE, "project": "AdAway", "license": "CC-BY-3.0",
                "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
                "sha256": hashlib.sha256(source.encode()).hexdigest(),
                "communityDomains": len(community), "baseDomains": len(base), "domains": len(merged)}
    return {"rules/advertising.json": [rule], "rules/sources.json": metadata}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check and args.update:
        parser.error("--check et --update sont incompatibles")
    source = (urllib.request.urlopen(SOURCE, timeout=30).read().decode("utf-8")
              if args.update else HOSTS.read_text())
    outputs = build(source)
    for name, data in outputs.items():
        value = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        destination = ROOT / name
        if args.check:
            if not destination.exists() or destination.read_text() != value:
                raise SystemExit(f"Fichier à régénérer : {name}")
        else:
            destination.write_text(value)
    if args.update:
        HOSTS.write_text(source)
    print(f"{outputs['rules/sources.json']['domains']} domaines ; source et génération vérifiées.")


if __name__ == "__main__":
    main()
